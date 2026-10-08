import { ForbiddenException, Injectable } from '@nestjs/common';
import { ASSIGNMENT_STATUS, ROLES } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';

/**
 * Estados de asignacion que dan acceso a la evidencia de una orden.
 *
 * PENDING y ACCEPTED: el conductor la tiene en curso y captura la evidencia.
 * COMPLETED: al marcar DELIVERED la asignacion pasa a COMPLETED, y el
 * conductor tiene que poder seguir viendo (y enviar tarde) la evidencia de la
 * orden que acaba de entregar. REJECTED y CANCELLED quedan fuera: ese
 * conductor ya no responde por la orden y la evidencia que capture el
 * siguiente lleva la cedula del receptor.
 */
export const EVIDENCE_ASSIGNMENT_STATUSES: ASSIGNMENT_STATUS[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.COMPLETED,
];

export type EvidenceEntityKind = 'ORDER' | 'DELIVERY_PROOF';
export type EvidenceAccessMode = 'read' | 'write';

/**
 * Reduce los entityType que escriben las apps ('DeliveryProof',
 * 'DELIVERY_PROOF', 'delivery_proof', 'ORDER', 'Order'...) a la entidad de la
 * que se puede saber el dueno. null: un tipo cuya propiedad no sabemos
 * resolver.
 */
export function normalizeEvidenceEntityType(
  entityType: string,
): EvidenceEntityKind | null {
  const key = entityType.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (key === 'DELIVERYPROOF') return 'DELIVERY_PROOF';
  if (key === 'ORDER' || key === 'TRANSPORTORDER') return 'ORDER';
  return null;
}

export interface OrderAccessOptions {
  /**
   * false: ser el cliente dueno de la orden no basta. Es para escribir
   * evidencia de entrega, que solo produce el conductor asignado (o staff).
   */
  allowCustomer?: boolean;
  message?: string;
}

const DEFAULT_DENIED_MESSAGE = 'You cannot access the evidence of this order';

/**
 * Quien puede ver o escribir evidencias (pruebas de entrega y adjuntos).
 * Un solo sitio para la regla, que antes vivia repetida (o faltaba) en cada
 * servicio:
 * - ADMIN / OPERATOR: sin restriccion.
 * - DRIVER: solo ordenes donde tiene una asignacion en
 *   EVIDENCE_ASSIGNMENT_STATUSES.
 * - CUSTOMER: solo ordenes de su propia cuenta de cliente.
 * Un usuario con varios roles entra si cualquiera de ellos le da acceso, como
 * en RealtimeService.canViewOrder.
 */
@Injectable()
export class EvidenceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isStaff(user: AuthenticatedUser): boolean {
    return user.roles.some(
      (role) => role === ROLES.ADMIN || role === ROLES.OPERATOR,
    );
  }

  async canAccessOrder(
    user: AuthenticatedUser,
    orderId: string,
    options: OrderAccessOptions = {},
  ): Promise<boolean> {
    if (this.isStaff(user)) {
      return true;
    }

    if (user.roles.includes(ROLES.DRIVER)) {
      // Filtro por relacion: una sola consulta, sin buscar antes el perfil.
      const assignment = await this.prisma.orderAssignment.findFirst({
        where: {
          orderId,
          driver: { userId: user.id },
          assignmentStatus: { in: EVIDENCE_ASSIGNMENT_STATUSES },
        },
        select: { id: true },
      });
      if (assignment) {
        return true;
      }
    }

    const allowCustomer = options.allowCustomer ?? true;
    if (allowCustomer && user.roles.includes(ROLES.CUSTOMER)) {
      const order = await this.prisma.transportOrder.findFirst({
        where: { id: orderId, customer: { userId: user.id } },
        select: { id: true },
      });
      if (order) {
        return true;
      }
    }

    return false;
  }

  /**
   * 403 tanto si la orden no existe como si no es suya: no se consulta la
   * existencia aparte, asi que no revela que ids de orden existen.
   */
  async assertOrderAccess(
    user: AuthenticatedUser,
    orderId: string,
    options: OrderAccessOptions = {},
  ): Promise<void> {
    if (await this.canAccessOrder(user, orderId, options)) {
      return;
    }
    throw this.denied(options.message);
  }

  /**
   * Acceso a los adjuntos de una entidad (GET/POST /attachments y upload).
   * Para DRIVER/CUSTOMER la entidad se resuelve a su orden; cualquier otro
   * entityType se rechaza porque no sabemos de quien es (por defecto
   * denegar, en vez de dejar leer o colgar archivos de entidades ajenas).
   */
  async assertEntityAccess(
    user: AuthenticatedUser,
    entityType: string,
    entityId: string,
    mode: EvidenceAccessMode,
  ): Promise<void> {
    if (this.isStaff(user)) {
      return;
    }

    const kind = normalizeEvidenceEntityType(entityType);
    if (kind === 'ORDER') {
      await this.assertOrderAccess(user, entityId);
      return;
    }

    if (kind === 'DELIVERY_PROOF') {
      const proof = await this.prisma.deliveryProof.findUnique({
        where: { id: entityId },
        select: { orderId: true },
      });
      // Mismo 403 exista o no la prueba, para no revelar ids ajenos.
      if (!proof) {
        throw this.denied();
      }
      // La foto de una prueba cuenta para cerrar la entrega
      // (assertDeliveryEvidenceReady): el cliente la puede ver, pero solo el
      // conductor asignado (o staff) la puede escribir.
      await this.assertOrderAccess(user, proof.orderId, {
        allowCustomer: mode === 'read',
      });
      return;
    }

    throw this.denied(
      'Drivers and customers can only access attachments of an order or a delivery proof',
    );
  }

  private denied(message = DEFAULT_DENIED_MESSAGE): ForbiddenException {
    return new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message });
  }
}
