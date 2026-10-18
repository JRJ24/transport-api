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
  opts: {
    assignment?: boolean;
    ownOrder?: boolean;
    proof?: boolean;
    /** Quien capturo la prueba; por defecto el mismo usuario de los tests. */
    proofCapturedBy?: string;
    ownUpload?: boolean;
  } = {},
) {
  return {
    deliveryProof: {
      findMany: jest.fn().mockResolvedValue([{ id: 'proof-1' }]),
      findUnique: jest.fn().mockResolvedValue(
        opts.proof
          ? {
              orderId: 'order-1',
              capturedBy: opts.proofCapturedBy ?? 'user-1',
            }
          : null,
      ),
      create: jest.fn().mockResolvedValue({ id: 'proof-new' }),
    },
    attachment: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'att-1', entityId: 'proof-1' }]),
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.ownUpload ? { id: 'att-sig' } : null),
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

const driverSelectOf = (prisma: ReturnType<typeof makePrisma>) =>
  (
    prisma.deliveryProof.findMany.mock.calls[0][0] as {
      include: { driver: { select: Record<string, boolean> } };
    }
  ).include.driver.select;

/** El conductor solo tiene una asignacion PENDING (aun sin aceptar). */
function withPendingAssignmentOnly(prisma: ReturnType<typeof makePrisma>) {
  prisma.orderAssignment.findFirst.mockImplementation(
    ({ where }: { where: { assignmentStatus: { in: string[] } } }) =>
      Promise.resolve(
        where.assignmentStatus.in.includes('PENDING') ? { id: 'asg-1' } : null,
      ),
  );
  return prisma;
}

const DENIED = {
  code: 'FORBIDDEN',
  message: 'You cannot create evidence for an unassigned order',
};

const SIGNATURE_DENIED = {
  code: 'FORBIDDEN',
  message: 'signatureUrl must be an image you uploaded to this delivery proof',
};

describe('DeliveryProofsService.list scoping', () => {
  it('staff keeps arbitrary filters without orderId (portal evidence page)', async () => {
    const prisma = makePrisma();
    await build(prisma).list(operator, {
      validationStatus: 'PENDING' as never,
    });
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

  it('staff still gets the capturing driver email (portal evidence page)', async () => {
    const prisma = makePrisma();
    await build(prisma).list(operator, {});
    expect(driverSelectOf(prisma)).toEqual({
      id: true,
      fullName: true,
      email: true,
    });
  });

  it.each([
    ['driver', driver, { assignment: true }],
    ['customer', customer, { ownOrder: true }],
  ])(
    '%s does not receive the capturing driver email',
    async (_l, user, opts) => {
      const prisma = makePrisma(opts);
      await build(prisma).list(user, { orderId: 'order-1' });
      expect(driverSelectOf(prisma)).toEqual({ id: true, fullName: true });
    },
  );

  it('a PENDING assignment is enough to read the proofs of the order', async () => {
    const prisma = withPendingAssignmentOnly(makePrisma());
    await build(prisma).list(driver, { orderId: 'order-1' });
    expect(prisma.deliveryProof.findMany).toHaveBeenCalledTimes(1);
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

  it('create: a driver whose assignment is still PENDING gets 403', async () => {
    const prisma = withPendingAssignmentOnly(makePrisma());
    const error = await build(prisma)
      .create(driver, createDto)
      .catch((e: unknown) => e);
    expect((error as ForbiddenException).getResponse()).toEqual(DENIED);
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        driver: { userId: 'user-1' },
        assignmentStatus: { in: ['ACCEPTED', 'COMPLETED'] },
      },
      select: { id: true },
    });
    expect(prisma.deliveryProof.create).not.toHaveBeenCalled();
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

  it('addSignature: for staff an unknown proof stays 404', async () => {
    const prisma = makePrisma({ proof: false });
    await expect(
      build(prisma).addSignature(operator, 'proof-x', signatureDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('addSignature: for a driver an unknown proof is the same 403 as a foreign one', async () => {
    const unknown = makePrisma({ proof: false, assignment: true });
    const unknownError = await build(unknown)
      .addSignature(driver, 'proof-x', signatureDto)
      .catch((e: unknown) => e);

    const foreign = makePrisma({ proof: true, assignment: false });
    const foreignError = await build(foreign)
      .addSignature(driver, 'proof-1', signatureDto)
      .catch((e: unknown) => e);

    expect(unknownError).toBeInstanceOf(ForbiddenException);
    expect(foreignError).toBeInstanceOf(ForbiddenException);
    expect((unknownError as ForbiddenException).getResponse()).toEqual(DENIED);
    expect((foreignError as ForbiddenException).getResponse()).toEqual(DENIED);
    expect(unknown.signature.create).not.toHaveBeenCalled();
    expect(foreign.signature.create).not.toHaveBeenCalled();
  });

  it('addSignature: driver of another order gets 403 before any upload lookup', async () => {
    const prisma = makePrisma({
      proof: true,
      assignment: false,
      ownUpload: true,
    });
    await expect(
      build(prisma).addSignature(driver, 'proof-1', signatureDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.signature.create).not.toHaveBeenCalled();
  });

  it('addSignature: assigned driver signs with the file they uploaded to this proof', async () => {
    const prisma = makePrisma({
      proof: true,
      assignment: true,
      ownUpload: true,
    });
    await build(prisma).addSignature(driver, 'proof-1', {
      signatureUrl: '  https://cdn.test/sig.webp ',
      signerName: ' Maria ',
    });
    // Lo que hacen las dos apps: upload con entityType DeliveryProof y
    // entityId = proof.id, y luego signatureUrl = file.url.
    expect(prisma.attachment.findFirst).toHaveBeenCalledWith({
      where: {
        entityType: {
          in: ['DeliveryProof', 'DELIVERY_PROOF', 'delivery_proof'],
        },
        entityId: 'proof-1',
        fileUrl: 'https://cdn.test/sig.webp',
        uploadedBy: 'user-1',
        // processUploadedFiles guarda toda imagen como image/webp.
        mimeType: { startsWith: 'image/' },
      },
      select: { id: true },
    });
    expect(prisma.signature.create).toHaveBeenCalledWith({
      data: {
        proofId: 'proof-1',
        signatureUrl: 'https://cdn.test/sig.webp',
        signerName: 'Maria',
      },
    });
  });

  it('addSignature: a proof captured by another driver of the same order is the same 403', async () => {
    // Orden reasignada: asignacion ACCEPTED y hasta un archivo propio subido,
    // pero la prueba la capturo el conductor anterior.
    const prisma = makePrisma({
      proof: true,
      proofCapturedBy: 'user-previous',
      assignment: true,
      ownUpload: true,
    });
    const error = await build(prisma)
      .addSignature(driver, 'proof-1', signatureDto)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(DENIED);
    expect(prisma.deliveryProof.findUnique).toHaveBeenCalledWith({
      where: { id: 'proof-1' },
      select: { orderId: true, capturedBy: true },
    });
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.signature.create).not.toHaveBeenCalled();
  });

  it('addSignature: a URL not uploaded by that driver to that proof is a 403', async () => {
    // Una URL publica cualquiera, la firma de otra prueba o la que subio otro
    // conductor: la consulta no la encuentra en ninguno de los tres casos.
    const prisma = makePrisma({
      proof: true,
      assignment: true,
      ownUpload: false,
    });
    const error = await build(prisma)
      .addSignature(driver, 'proof-1', {
        signatureUrl: 'https://cdn.test/someone-else-signature.webp',
        signerName: 'Maria',
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(
      SIGNATURE_DENIED,
    );
    expect(prisma.signature.create).not.toHaveBeenCalled();
  });

  it('addSignature: an own upload to this proof that is not an image (PDF, video) is the same 403', async () => {
    // Simula la base: el conductor subio a esta prueba un PDF propio con esa
    // URL; findFirst solo lo encuentra si el filtro no exige imagen.
    const prisma = makePrisma({ proof: true, assignment: true });
    const ownPdf = {
      fileUrl: 'https://cdn.test/evidences/x-contrato.pdf',
      mimeType: 'application/pdf',
    };
    prisma.attachment.findFirst.mockImplementation(
      ({
        where,
      }: {
        where: { fileUrl: string; mimeType?: { startsWith: string } };
      }) =>
        Promise.resolve(
          where.fileUrl === ownPdf.fileUrl &&
            (!where.mimeType ||
              ownPdf.mimeType.startsWith(where.mimeType.startsWith))
            ? { id: 'att-pdf' }
            : null,
        ),
    );

    const error = await build(prisma)
      .addSignature(driver, 'proof-1', {
        signatureUrl: ownPdf.fileUrl,
        signerName: 'Maria',
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(
      SIGNATURE_DENIED,
    );
    expect(prisma.signature.create).not.toHaveBeenCalled();
  });

  it('addSignature: an own webp upload (what both driver apps end up storing) is accepted', async () => {
    const prisma = makePrisma({ proof: true, assignment: true });
    const ownSignature = {
      fileUrl: 'https://cdn.test/evidences/x-signature.webp',
      mimeType: 'image/webp',
    };
    prisma.attachment.findFirst.mockImplementation(
      ({
        where,
      }: {
        where: { fileUrl: string; mimeType?: { startsWith: string } };
      }) =>
        Promise.resolve(
          where.fileUrl === ownSignature.fileUrl &&
            (!where.mimeType ||
              ownSignature.mimeType.startsWith(where.mimeType.startsWith))
            ? { id: 'att-sig' }
            : null,
        ),
    );

    await expect(
      build(prisma).addSignature(driver, 'proof-1', {
        signatureUrl: ownSignature.fileUrl,
        signerName: 'Maria',
      }),
    ).resolves.toEqual({ id: 'sig-1' });
  });

  it('addSignature: a driver whose assignment is still PENDING gets 403', async () => {
    const prisma = withPendingAssignmentOnly(
      makePrisma({ proof: true, ownUpload: true }),
    );
    const error = await build(prisma)
      .addSignature(driver, 'proof-1', signatureDto)
      .catch((e: unknown) => e);
    expect((error as ForbiddenException).getResponse()).toEqual(DENIED);
    expect(prisma.signature.create).not.toHaveBeenCalled();
  });

  it('addSignature: staff keeps signing without the upload check', async () => {
    // Tambien una prueba que capturo un conductor (portal).
    const prisma = makePrisma({
      proof: true,
      proofCapturedBy: 'driver-user',
      ownUpload: false,
    });
    await build(prisma).addSignature(operator, 'proof-1', signatureDto);
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
    expect(prisma.signature.create).toHaveBeenCalledTimes(1);
  });
});
