import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import { EvidenceAccessService } from '../evidence-access/evidence-access.service';
import { DeliveryProofsService } from './delivery-proofs.service';

const base: AuthenticatedUser = {
  id: 'user-1',
  email: 'u@x.com',
  fullName: 'User',
  status: 'ACTIVE' as never,
  roles: [],
  permissions: [],
  sessionId: 's1',
};
const driver = { ...base, roles: ['DRIVER'] as never };
const customer = { ...base, roles: ['CUSTOMER'] as never };
const operator = { ...base, roles: ['OPERATOR'] as never };

function makePrisma(
  opts: { assignment?: boolean; ownOrder?: boolean; proof?: boolean } = {},
) {
  return {
    deliveryProof: {
      findMany: jest.fn().mockResolvedValue([{ id: 'proof-1' }]),
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.proof ? { orderId: 'order-1' } : null),
      create: jest.fn().mockResolvedValue({ id: 'proof-new' }),
    },
    attachment: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'att-1', entityId: 'proof-1' }]),
    },
    signature: { create: jest.fn().mockResolvedValue({ id: 'sig-1' }) },
    orderAssignment: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.assignment ? { id: 'asg-1' } : null),
    },
    transportOrder: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.ownOrder ? { id: 'order-1' } : null),
    },
  };
}

function build(prisma: ReturnType<typeof makePrisma>) {
  const asPrisma = prisma as unknown as PrismaService;
  return new DeliveryProofsService(
    asPrisma,
    new EvidenceAccessService(asPrisma),
  );
}

const whereOf = (prisma: ReturnType<typeof makePrisma>) =>
  (
    prisma.deliveryProof.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }
  ).where;

describe('DeliveryProofsService.list scoping', () => {
  it('staff keeps arbitrary filters without orderId (portal evidence page)', async () => {
    const prisma = makePrisma();
    await build(prisma).list(operator, { validationStatus: 'PENDING' as never });
    expect(whereOf(prisma)).toEqual({ validationStatus: 'PENDING' });
    expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['driver', driver],
    ['customer', customer],
  ])('%s without orderId gets 400 and no query runs', async (_l, user) => {
    const prisma = makePrisma({ assignment: true, ownOrder: true });
    await expect(
      build(prisma).list(user, { search: '001' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.deliveryProof.findMany).not.toHaveBeenCalled();
  });

  it('assigned driver lists only the proofs of that order', async () => {
    const prisma = makePrisma({ assignment: true });
    const result = await build(prisma).list(driver, { orderId: 'order-1' });
    expect(whereOf(prisma)).toEqual({ orderId: 'order-1' });
    expect(result).toEqual([
      { id: 'proof-1', attachments: [{ id: 'att-1', entityId: 'proof-1' }] },
    ]);
  });

  it('driver not assigned to the order gets 403 and no proofs are read', async () => {
    const prisma = makePrisma({ assignment: false });
    await expect(
      build(prisma).list(driver, { orderId: 'order-9' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.deliveryProof.findMany).not.toHaveBeenCalled();
  });

  it('customer lists the proofs of their own order (EvidenceGallery)', async () => {
    const prisma = makePrisma({ ownOrder: true });
    await build(prisma).list(customer, { orderId: 'order-1' });
    expect(whereOf(prisma)).toEqual({ orderId: 'order-1' });
  });

  it('customer gets 403 for an order of another customer', async () => {
    const prisma = makePrisma({ ownOrder: false });
    await expect(
      build(prisma).list(customer, { orderId: 'order-9' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.deliveryProof.findMany).not.toHaveBeenCalled();
  });
});

describe('DeliveryProofsService write paths keep their checks', () => {
  const createDto = {
    orderId: 'order-1',
    proofType: 'MIXED' as never,
    recipientName: 'Maria',
    recipientDocument: '001',
    latitude: 18.4,
    longitude: -69.9,
  };

  it('create: assigned driver can capture the proof', async () => {
    const prisma = makePrisma({ assignment: true });
    await build(prisma).create(driver, createDto);
    expect(prisma.deliveryProof.create).toHaveBeenCalledTimes(1);
  });

  it('create: unassigned driver gets 403 with the previous message', async () => {
    const prisma = makePrisma({ assignment: false });
    const error = await build(prisma)
      .create(driver, createDto)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      code: 'FORBIDDEN',
      message: 'You cannot create evidence for an unassigned order',
    });
    expect(prisma.deliveryProof.create).not.toHaveBeenCalled();
  });

  it('create: being the customer of the order is not enough', async () => {
    const prisma = makePrisma({ ownOrder: true });
    await expect(
      build(prisma).create(customer, createDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
  });

  it('create: staff bypasses the assignment check', async () => {
    const prisma = makePrisma();
    await build(prisma).create(operator, createDto);
    expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
    expect(prisma.deliveryProof.create).toHaveBeenCalledTimes(1);
  });

  const signatureDto = {
    signatureUrl: 'https://cdn.test/sig.webp',
    signerName: 'Maria',
  };

  it('addSignature: unknown proof stays 404', async () => {
    const prisma = makePrisma({ proof: false, assignment: true });
    await expect(
      build(prisma).addSignature(driver, 'proof-x', signatureDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('addSignature: driver of another order gets 403', async () => {
    const prisma = makePrisma({ proof: true, assignment: false });
    await expect(
      build(prisma).addSignature(driver, 'proof-1', signatureDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.signature.create).not.toHaveBeenCalled();
  });

  it('addSignature: assigned driver signs', async () => {
    const prisma = makePrisma({ proof: true, assignment: true });
    await build(prisma).addSignature(driver, 'proof-1', signatureDto);
    expect(prisma.signature.create).toHaveBeenCalledTimes(1);
  });
});
