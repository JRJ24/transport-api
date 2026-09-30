import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DeliveryProof,
  Prisma,
  Signature,
} from '@generated/prisma/client';
import { ROLES, STOP_TYPE, VALIDATION } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
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

@Injectable()
export class DeliveryProofsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: DeliveryProofQueryDto): Promise<DeliveryProof[]> {
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
        driver: { select: { id: true, fullName: true, email: true } },
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
    await this.assertDriverAssignedToOrder(user, dto.orderId);

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
    const proof = await this.prisma.deliveryProof.findUnique({
      where: { id: proofId },
      select: { orderId: true },
    });

    if (!proof) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Delivery proof not found',
      });
    }

    await this.assertDriverAssignedToOrder(user, proof.orderId);

    return this.prisma.signature.create({
      data: {
        proofId,
        signatureUrl: dto.signatureUrl.trim(),
        signerName: dto.signerName.trim(),
      },
    });
  }

  private async assertDriverAssignedToOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<void> {
    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      return;
    }

    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });

    if (!driver) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Driver profile not found',
      });
    }

    const assignment = await this.prisma.orderAssignment.findFirst({
      where: { orderId, driverId: driver.id },
      select: { id: true },
    });

    if (!assignment) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You cannot create evidence for an unassigned order',
      });
    }
  }
}
