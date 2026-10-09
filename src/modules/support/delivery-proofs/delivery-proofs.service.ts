import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DeliveryProof,
  Prisma,
  Signature,
} from '@generated/prisma/client';
import { STOP_TYPE, VALIDATION } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { EvidenceAccessService } from '../evidence-access/evidence-access.service';
import type { DeliveryProofQueryDto } from './dto/delivery-proof-query.dto';
import type { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import type { CreateSignatureDto } from './dto/create-signature.dto';
import type { ValidateDeliveryProofDto } from './dto/validate-delivery-proof.dto';

/** Attachment.entityType values the apps write for delivery proof photos. */
const PROOF_ENTITY_TYPES = [
  'DeliveryProof',
  'DELIVERY_PROOF',
  'delivery_proof',
];

/** El 403 de siempre al escribir evidencia de una orden que no es suya. */
const WRITE_DENIED_MESSAGE =
  'You cannot create evidence for an unassigned order';

@Injectable()
export class DeliveryProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EvidenceAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: DeliveryProofQueryDto,
  ): Promise<DeliveryProof[]> {
    // El portal (staff) filtra libremente. Conductor y cliente solo ven las
    // pruebas de una orden suya: sin orderId el listado devolvia las de
    // todas las ordenes, con la cedula del receptor y el email del conductor.
    if (!this.access.isStaff(user)) {
      if (!query.orderId) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'orderId is required',
        });
      }
      await this.access.assertOrderAccess(user, query.orderId);
    }

    const where: Prisma.DeliveryProofWhereInput = {
      ...(query.orderId && { orderId: query.orderId }),
      ...(query.proofType && { proofType: query.proofType }),
      ...(query.validationStatus && {
        validationStatus: query.validationStatus,
      }),
      ...((query.from || query.to) && {
        capturedAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { recipientName: { contains: search, mode: 'insensitive' } },
        { recipientDocument: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        {
          order: {
            is: { orderCode: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    // El email del conductor solo lo usa el portal (staff). El cliente no lo
    // muestra (EvidenceGallery) y no tiene por que tener el contacto personal
    // del conductor; las apps de conductor tampoco lo leen.
    const driverSelect = this.access.isStaff(user)
      ? { id: true, fullName: true, email: true }
      : { id: true, fullName: true };

    const proofs = await this.prisma.deliveryProof.findMany({
      where,
      include: {
        signatures: true,
        order: {
          select: {
            id: true,
            orderCode: true,
            status: true,
            // The delivery stop, to compare against where the proof was taken.
            orderStops: {
              where: { stopType: STOP_TYPE.DROPOFF },
              orderBy: { sequence: 'desc' },
              take: 1,
              select: { addressLine: true, latitude: true, longitude: true },
            },
          },
        },
        driver: { select: driverSelect },
      },
      orderBy: { capturedAt: 'desc' },
    });

    // Photos are Attachments linked by entity, not a relation: one query for
    // the whole page instead of one per proof.
    const attachments = proofs.length
      ? await this.prisma.attachment.findMany({
          where: {
            entityType: { in: PROOF_ENTITY_TYPES },
            entityId: { in: proofs.map((proof) => proof.id) },
          },
          select: {
            id: true,
            entityId: true,
            fileName: true,
            fileUrl: true,
            mimeType: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    return proofs.map((proof) => ({
      ...proof,
      attachments: attachments.filter((file) => file.entityId === proof.id),
    }));
  }

  create(
    user: AuthenticatedUser,
    dto: CreateDeliveryProofDto,
  ): Promise<DeliveryProof> {
    return this.createAuthorized(user, dto);
  }

  private async createAuthorized(
    user: AuthenticatedUser,
    dto: CreateDeliveryProofDto,
  ): Promise<DeliveryProof> {
    await this.assertCanWriteEvidence(user, dto.orderId);

    return this.prisma.deliveryProof.create({
      data: {
        orderId: dto.orderId,
        proofType: dto.proofType,
        recipientName: dto.recipientName.trim(),
        recipientDocument: dto.recipientDocument.trim(),
        notes: dto.notes?.trim() ?? null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        capturedBy: user.id,
        validatedAt: new Date(),
        validationStatus: VALIDATION.PENDING,
      },
    });
  }

  async validate(
    id: string,
    dto: ValidateDeliveryProofDto,
    actorUserId?: string,
  ): Promise<DeliveryProof> {
    const current = await this.prisma.deliveryProof.findUnique({
      where: { id },
      select: { validationStatus: true, notes: true },
    });
    if (!current) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Delivery proof not found',
      });
    }
    const reason = dto.reason?.trim();
    const updated = await this.prisma.deliveryProof.update({
      where: { id },
      data: {
        validationStatus: dto.validationStatus,
        validatedAt: new Date(),
        ...(reason && {
          notes: [current.notes, `[Revisión] ${reason}`]
            .filter(Boolean)
            .join('\n'),
        }),
      },
    });
    if (actorUserId) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId,
          action: 'DELIVERY_PROOF_REVIEWED',
          entityType: 'DeliveryProof',
          entityId: id,
          oldValues: { validationStatus: current.validationStatus },
          newValues: {
            validationStatus: dto.validationStatus,
            ...(reason && { reason }),
          },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });
    }
    return updated;
  }

  async addSignature(
    user: AuthenticatedUser,
    proofId: string,
    dto: CreateSignatureDto,
  ): Promise<Signature> {
    const isStaff = this.access.isStaff(user);
    const signatureUrl = dto.signatureUrl.trim();
    const proof = await this.prisma.deliveryProof.findUnique({
      where: { id: proofId },
      select: { orderId: true, capturedBy: true },
    });

    if (!proof) {
      // Para conductor o cliente, el mismo 403 que una prueba ajena: un 404
      // aparte revelaba que ids de prueba existen. Staff conserva el 404.
      if (!isStaff) {
        throw this.writeDenied();
      }
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Delivery proof not found',
      });
    }

    await this.assertCanWriteEvidence(user, proof.orderId);

    if (!isStaff) {
      // La asignacion es de la orden: tras una reasignacion el conductor
      // nuevo podia firmar la prueba que capturo el anterior. Las apps solo
      // firman la prueba que acaban de crear. Mismo 403 que una orden ajena.
      if (proof.capturedBy !== user.id) {
        throw this.writeDenied();
      }
      await this.assertOwnSignatureUpload(user, proofId, signatureUrl);
    }

    return this.prisma.signature.create({
      data: {
        proofId,
        signatureUrl,
        signerName: dto.signerName.trim(),
      },
    });
  }

  /**
   * La firma cuenta para cerrar la entrega (assertDeliveryEvidenceReady), y
   * signatureUrl era texto libre: el conductor podia "firmar" con la URL de
   * cualquier imagen publica, incluida la firma de otra entrega. Ahora tiene
   * que ser un archivo que el mismo subio a esta prueba por
   * /attachments/upload, que es justo lo que hacen las dos apps de conductor
   * (suben foto + firma con entityType DeliveryProof y mandan file.url).
   *
   * Ademas tiene que ser una imagen: con cualquier archivo propio (un PDF o
   * un video subido a la misma prueba) la "firma" contaba igual para cerrar
   * la entrega. Las dos apps mandan la firma como imagen (app-drivers PNG,
   * transport-driver SVG) y processUploadedFiles convierte toda imagen a webp,
   * asi que el adjunto guardado siempre queda con mimeType image/webp.
   *
   * 403 y no 400: lo que se bloquea es usar evidencia que no es suya (la
   * convencion de EvidenceAccessService). Y la misma respuesta si la URL no
   * existe, es de otra prueba, la subio otro usuario o no es una imagen: la
   * consulta filtra por uploadedBy, asi que no sirve para averiguar de quien
   * es una URL.
   */
  private async assertOwnSignatureUpload(
    user: AuthenticatedUser,
    proofId: string,
    signatureUrl: string,
  ): Promise<void> {
    const upload = await this.prisma.attachment.findFirst({
      where: {
        entityType: { in: PROOF_ENTITY_TYPES },
        entityId: proofId,
        fileUrl: signatureUrl,
        uploadedBy: user.id,
        mimeType: { startsWith: 'image/' },
      },
      select: { id: true },
    });

    if (!upload) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message:
          'signatureUrl must be an image you uploaded to this delivery proof',
      });
    }
  }

  /**
   * Misma regla que antes (staff libre, conductor con asignacion en la orden)
   * pero desde EvidenceAccessService: una asignacion REJECTED o CANCELLED ya
   * no basta, ser el cliente de la orden tampoco, y en modo 'write' una
   * PENDING (aun sin aceptar) tampoco.
   */
  private assertCanWriteEvidence(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<void> {
    return this.access.assertOrderAccess(user, orderId, {
      allowCustomer: false,
      mode: 'write',
      message: WRITE_DENIED_MESSAGE,
    });
  }

  private writeDenied(): ForbiddenException {
    return new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: WRITE_DENIED_MESSAGE,
    });
  }
}
