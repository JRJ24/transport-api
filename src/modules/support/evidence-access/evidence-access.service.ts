import { ForbiddenException, Injectable } from '@nestjs/common';
import { ASSIGNMENT_STATUS, ROLES } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';

/**
 * Estados de asignacion que dejan VER la evidencia de una orden.
 *
 * PENDING: se la asignaron y todavia no la acepta; ya puede abrir el detalle
 * de la orden, y la evidencia es parte de ese detalle.
 * ACCEPTED: la tiene en curso.
 * COMPLETED: al marcar DELIVERED la asignacion pasa a COMPLETED, y el
 * conductor tiene que poder seguir viendo la evidencia de la orden que acaba
 * de entregar. REJECTED y CANCELLED quedan fuera: ese conductor ya no
 * responde por la orden y la evidencia que capture el siguiente lleva la
 * cedula del receptor.
 */
export const EVIDENCE_READ_ASSIGNMENT_STATUSES: ASSIGNMENT_STATUS[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.COMPLETED,
];

/**
 * Estados de asignacion que dejan ESCRIBIR evidencia (pruebas, firmas,
 * adjuntos). Sin PENDING: quien aun no acepto la orden no la lleva, y una
 * prueba suya contaria para cerrar la entrega (assertDeliveryEvidenceReady)
 * de un servicio que puede terminar haciendo otro conductor. OrdersService
 * tampoco deja que una PENDING cambie el estado de la orden: la captura
 * normal (orden IN_PROGRESS o recien DELIVERED) siempre llega con ACCEPTED o
 * COMPLETED, y con PENDING la evidencia no serviria para cerrar la entrega.
 * COMPLETED sigue: las apps pueden enviar la evidencia justo despues de
 * marcar DELIVERED.
 */
export const EVIDENCE_WRITE_ASSIGNMENT_STATUSES: ASSIGNMENT_STATUS[] = [
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
  /**
   * 'write' exige una asignacion en EVIDENCE_WRITE_ASSIGNMENT_STATUSES. Por
   * defecto 'read', que es lo que piden los listados.
   */
  mode?: EvidenceAccessMode;
  message?: string;
}

const DEFAULT_DENIED_MESSAGE = 'You cannot access the evidence of this order';

/**
 * Quien puede ver o escribir evidencias (pruebas de entrega y adjuntos).
 * Un solo sitio para la regla, que antes vivia repetida (o faltaba) en cada
 * servicio:
 * - ADMIN / OPERATOR: sin restriccion.
 * - DRIVER: solo ordenes donde tiene una asignacion en
 *   EVIDENCE_READ_ASSIGNMENT_STATUSES para ver, o en
 *   EVIDENCE_WRITE_ASSIGNMENT_STATUSES para escribir.
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
      const statuses =
        options.mode === 'write'
          ? EVIDENCE_WRITE_ASSIGNMENT_STATUSES
          : EVIDENCE_READ_ASSIGNMENT_STATUSES;
      // Filtro por relacion: una sola consulta, sin buscar antes el perfil.
      const assignment = await this.prisma.orderAssignment.findFirst({
        where: {
          orderId,
          driver: { userId: user.id },
          assignmentStatus: { in: statuses },
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
   * En modo 'write' el cliente nunca entra: solo el conductor asignado (o
   * staff) produce adjuntos.
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
      // El cliente ve los adjuntos de su orden pero no sube: ninguna app de
      // cliente usa /attachments/upload, y con allowCustomer en 'write' podia
      // colgar archivos publicos de su orden (o usarla de almacen). Las
      // incidencias, que el cliente si escribe, no pasan por aqui: llaman a
      // assertOrderAccess con allowCustomer explicito (IncidentsService).
      await this.assertOrderAccess(user, entityId, {
        allowCustomer: mode === 'read',
        mode,
      });
      return;
    }

    if (kind === 'DELIVERY_PROOF') {
      const proof = await this.prisma.deliveryProof.findUnique({
        where: { id: entityId },
        select: { orderId: true, capturedBy: true },
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
        mode,
      });
      // Escribir, ademas, solo en una prueba que capturo el mismo. La
      // asignacion es de la orden, no de la prueba: si la orden se reasigna,
      // el conductor nuevo (ACCEPTED) podia colgar fotos en la prueba del
      // anterior. Las dos apps de conductor solo suben a la prueba que
      // acaban de crear. Mismo 403 que arriba: no distingue el motivo.
      if (mode === 'write' && proof.capturedBy !== user.id) {
        throw this.denied();
      }
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
