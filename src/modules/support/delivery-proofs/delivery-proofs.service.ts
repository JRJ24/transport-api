import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  DeliveryProof,
  Prisma,
  Signature,
} from '@generated/prisma/client';
import { ROLES, VALIDATION } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { DeliveryProofQueryDto } from './dto/delivery-proof-query.dto';
import type { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import type { CreateSignatureDto } from './dto/create-signature.dto';
import type { ValidateDeliveryProofDto } from './dto/validate-delivery-proof.dto';

@Injectable()
export class DeliveryProofsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: DeliveryProofQueryDto): Promise<DeliveryProof[]> {
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

    return this.prisma.deliveryProof.findMany({
      where,
      include: {
        signatures: true,
        order: { select: { id: true, orderCode: true, status: true } },
        driver: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { capturedAt: 'desc' },
    });
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

  validate(id: string, dto: ValidateDeliveryProofDto): Promise<DeliveryProof> {
    return this.prisma.deliveryProof.update({
      where: { id },
      data: { validationStatus: dto.validationStatus, validatedAt: new Date() },
    });
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
    if (user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)) {
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
