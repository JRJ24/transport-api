import { Injectable } from '@nestjs/common';
import type { DeliveryProof, Signature } from '@generated/prisma/client';
import { VALIDATION } from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import type { CreateSignatureDto } from './dto/create-signature.dto';
import type { ValidateDeliveryProofDto } from './dto/validate-delivery-proof.dto';

@Injectable()
export class DeliveryProofsService {
  constructor(private readonly prisma: PrismaService) {}

  list(orderId?: string): Promise<DeliveryProof[]> {
    return this.prisma.deliveryProof.findMany({
      where: { ...(orderId && { orderId }) },
      include: { signatures: true },
      orderBy: { capturedAt: 'desc' },
    });
  }

  create(
    user: AuthenticatedUser,
    dto: CreateDeliveryProofDto,
  ): Promise<DeliveryProof> {
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

  addSignature(proofId: string, dto: CreateSignatureDto): Promise<Signature> {
    return this.prisma.signature.create({
      data: {
        proofId,
        signatureUrl: dto.signatureUrl.trim(),
        signerName: dto.signerName.trim(),
      },
    });
  }
}
