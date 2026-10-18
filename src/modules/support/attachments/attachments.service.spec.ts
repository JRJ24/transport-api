import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import {
  processUploadedFiles,
  type UploadedFile,
} from '@/common/middlewares/processFile';
import type { PrismaService } from '@/database/prisma.service';
import { EvidenceAccessService } from '../evidence-access/evidence-access.service';
import { AttachmentsService } from './attachments.service';

jest.mock('@/common/middlewares/processFile', () => ({
  processUploadedFiles: jest.fn(),
}));

const processUploadedFilesMock = processUploadedFiles as jest.MockedFunction<
  typeof processUploadedFiles
>;

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
const admin = { ...base, roles: ['ADMIN'] as never };
const operator = { ...base, roles: ['OPERATOR'] as never };

const req = {} as Request;

const multerFile = (name: string): Express.Multer.File =>
  ({
    fieldname: 'files',
    originalname: name,
    mimetype: 'image/jpeg',
    buffer: Buffer.from('x'),
    size: 1,
  }) as Express.Multer.File;

const stored = (name: string): UploadedFile => ({
  fieldName: 'files',
  key: `evidences/${name}`,
  fileName: name,
  originalName: name,
  mimeType: 'image/webp',
  size: 10,
  url: `https://cdn.test/evidences/${name}`,
});

function makePrisma(
  opts: {
    assignment?: boolean;
    proofOrderId?: string;
    /** Quien capturo la prueba; por defecto el mismo usuario de los tests. */
    proofCapturedBy?: string;
  } = {},
) {
  return {
    attachment: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: `att-${String(data.fileName)}`, ...data }),
        ),
      findMany: jest.fn().mockResolvedValue([{ id: 'att-1' }]),
    },
    orderAssignment: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.assignment ? { id: 'asg-1' } : null),
    },
    transportOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    deliveryProof: {
      findUnique: jest.fn().mockResolvedValue(
        opts.proofOrderId
          ? {
              orderId: opts.proofOrderId,
              capturedBy: opts.proofCapturedBy ?? 'user-1',
            }
          : null,
      ),
    },
  };
}

function build(prisma: ReturnType<typeof makePrisma>) {
  const asPrisma = prisma as unknown as PrismaService;
  return new AttachmentsService(asPrisma, new EvidenceAccessService(asPrisma));
}

beforeEach(() => {
  processUploadedFilesMock.mockReset();
  processUploadedFilesMock.mockImplementation((files) =>
    Promise.resolve(files.map((file) => stored(file.originalname))),
  );
});

describe('AttachmentsService.upload', () => {
  it('stores and links the files when the driver is assigned to the proof order', async () => {
    const prisma = makePrisma({ assignment: true, proofOrderId: 'order-1' });
    const order: string[] = [];
    prisma.orderAssignment.findFirst.mockImplementation(() => {
      order.push('authorize');
      return Promise.resolve({ id: 'asg-1' });
    });
    processUploadedFilesMock.mockImplementation((files) => {
      order.push('store');
      return Promise.resolve(files.map((file) => stored(file.originalname)));
    });

    const result = await build(prisma).upload(
      driver,
      [multerFile('photo.jpg'), multerFile('signature.png')],
      { entityType: ' DeliveryProof ', entityId: 'proof-1' },
      req,
    );

    expect(order).toEqual(['authorize', 'store']);
    expect(processUploadedFilesMock).toHaveBeenCalledWith(
      [expect.any(Object), expect.any(Object)],
      req,
    );
    // Mismo contrato que antes: { file, attachment } por archivo.
    expect(result).toHaveLength(2);
    expect(result[0].file.url).toBe('https://cdn.test/evidences/photo.jpg');
    expect(result[0].attachment).toMatchObject({
      entityType: 'DeliveryProof',
      entityId: 'proof-1',
      fileUrl: 'https://cdn.test/evidences/photo.jpg',
      uploadedBy: 'user-1',
    });
  });

  it('403 and nothing stored when the proof belongs to another driver order', async () => {
    const prisma = makePrisma({ assignment: false, proofOrderId: 'order-9' });

    await expect(
      build(prisma).upload(
        driver,
        [multerFile('photo.jpg')],
        { entityType: 'DeliveryProof', entityId: 'proof-9' },
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(processUploadedFilesMock).not.toHaveBeenCalled();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('403 and nothing stored on a proof another driver captured on the same order', async () => {
    // Orden reasignada: el conductor actual tiene la asignacion ACCEPTED, pero
    // la prueba es del conductor anterior.
    const prisma = makePrisma({
      assignment: true,
      proofOrderId: 'order-1',
      proofCapturedBy: 'user-previous',
    });

    const error = await build(prisma)
      .upload(
        driver,
        [multerFile('photo.jpg')],
        { entityType: 'DeliveryProof', entityId: 'proof-1' },
        req,
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      code: 'FORBIDDEN',
      message: 'You cannot access the evidence of this order',
    });
    expect(processUploadedFilesMock).not.toHaveBeenCalled();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('403 and nothing stored for a customer writing on a delivery proof', async () => {
    const prisma = makePrisma({ proofOrderId: 'order-1' });
    prisma.transportOrder.findFirst.mockResolvedValue({ id: 'order-1' });

    await expect(
      build(prisma).upload(
        customer,
        [multerFile('photo.jpg')],
        { entityType: 'DeliveryProof', entityId: 'proof-1' },
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(processUploadedFilesMock).not.toHaveBeenCalled();
  });

  it.each(['ORDER', 'Order', 'TransportOrder'])(
    '403 and nothing stored for a customer uploading to %s of their OWN order',
    async (entityType) => {
      // Ninguna app de cliente sube adjuntos: antes el camino ORDER dejaba al
      // cliente colgar archivos publicos de su orden.
      const prisma = makePrisma();
      prisma.transportOrder.findFirst.mockResolvedValue({ id: 'order-1' });

      const error = await build(prisma)
        .upload(
          customer,
          [multerFile('photo.jpg')],
          { entityType, entityId: 'order-1' },
          req,
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        code: 'FORBIDDEN',
        message: 'You cannot access the evidence of this order',
      });
      expect(processUploadedFilesMock).not.toHaveBeenCalled();
      expect(prisma.attachment.create).not.toHaveBeenCalled();
    },
  );

  it('the assigned driver can still upload to ORDER', async () => {
    const prisma = makePrisma({ assignment: true });
    const result = await build(prisma).upload(
      driver,
      [multerFile('doc.jpg')],
      { entityType: 'ORDER', entityId: 'order-1' },
      req,
    );
    expect(result[0].attachment).toMatchObject({
      entityType: 'ORDER',
      entityId: 'order-1',
    });
    expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
  });

  it('403 and nothing stored for an entityType whose owner cannot be resolved', async () => {
    const prisma = makePrisma({ assignment: true });

    await expect(
      build(prisma).upload(
        driver,
        [multerFile('doc.pdf')],
        { entityType: 'Vehicle', entityId: 'veh-1' },
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(processUploadedFilesMock).not.toHaveBeenCalled();
  });

  it('without entity staff only stores the file (attachment null)', async () => {
    const prisma = makePrisma();

    const result = await build(prisma).upload(
      operator,
      [multerFile('photo.jpg')],
      {},
      req,
    );

    expect(processUploadedFilesMock).toHaveBeenCalledTimes(1);
    expect(prisma.deliveryProof.findUnique).not.toHaveBeenCalled();
    expect(result).toEqual([{ file: stored('photo.jpg'), attachment: null }]);
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  // '  ' pasa Length(2, 80) del DTO y recortado queda vacio.
  it.each([
    ['no fields', {}],
    ['only entityType', { entityType: 'DeliveryProof' }],
    ['only entityId', { entityId: 'proof-1' }],
    ['whitespace entityType', { entityType: '   ', entityId: 'proof-1' }],
    ['whitespace entityId', { entityType: 'DeliveryProof', entityId: '  ' }],
    ['both whitespace', { entityType: '  ', entityId: '  ' }],
  ])(
    'driver/customer with %s: 400 before any lookup or storage',
    async (_label, dto) => {
      for (const user of [driver, customer]) {
        const prisma = makePrisma({
          assignment: true,
          proofOrderId: 'order-1',
        });
        const error = await build(prisma)
          .upload(user, [multerFile('photo.jpg')], dto, req)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        // Mismo mensaje que GET /attachments sin entidad.
        expect((error as BadRequestException).getResponse()).toEqual({
          code: 'BAD_REQUEST',
          message: 'entityType and entityId are required',
        });
        expect(prisma.deliveryProof.findUnique).not.toHaveBeenCalled();
        expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
        expect(prisma.attachment.create).not.toHaveBeenCalled();
      }
      expect(processUploadedFilesMock).not.toHaveBeenCalled();
    },
  );

  it('driver without entity and without files is still a 400 (not an empty 201)', async () => {
    const prisma = makePrisma();
    await expect(
      build(prisma).upload(driver, undefined, {}, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['only entityType', { entityType: 'Incident' }],
    ['only entityId', { entityId: 'inc-1' }],
    [
      'entityType + whitespace entityId',
      { entityType: 'Incident', entityId: '  ' },
    ],
  ])('staff with %s: 400, nothing stored', async (_label, dto) => {
    const prisma = makePrisma();
    const error = await build(prisma)
      .upload(admin, [multerFile('doc.jpg')], dto, req)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: 'BAD_REQUEST',
      message: 'entityType and entityId must be sent together',
    });
    expect(processUploadedFilesMock).not.toHaveBeenCalled();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('trims entityId before authorizing and linking', async () => {
    const prisma = makePrisma({ assignment: true, proofOrderId: 'order-1' });
    const [result] = await build(prisma).upload(
      driver,
      [multerFile('photo.jpg')],
      { entityType: 'DeliveryProof', entityId: '  proof-1 ' },
      req,
    );
    expect(prisma.deliveryProof.findUnique).toHaveBeenCalledWith({
      where: { id: 'proof-1' },
      select: { orderId: true, capturedBy: true },
    });
    expect(result.attachment).toMatchObject({ entityId: 'proof-1' });
  });

  it('403 and nothing stored for a driver whose assignment is still PENDING', async () => {
    const prisma = makePrisma({ proofOrderId: 'order-1' });
    // Solo tiene una asignacion PENDING: aparece si se buscan los estados de
    // lectura, no con los de escritura.
    prisma.orderAssignment.findFirst.mockImplementation(
      ({ where }: { where: { assignmentStatus: { in: string[] } } }) =>
        Promise.resolve(
          where.assignmentStatus.in.includes('PENDING')
            ? { id: 'asg-1' }
            : null,
        ),
    );

    await expect(
      build(prisma).upload(
        driver,
        [multerFile('photo.jpg')],
        { entityType: 'DeliveryProof', entityId: 'proof-1' },
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        driver: { userId: 'user-1' },
        assignmentStatus: { in: ['ACCEPTED', 'COMPLETED'] },
      },
      select: { id: true },
    });
    expect(processUploadedFilesMock).not.toHaveBeenCalled();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('no files: returns [] and stores nothing', async () => {
    const prisma = makePrisma({ assignment: true, proofOrderId: 'order-1' });
    await expect(
      build(prisma).upload(
        driver,
        undefined,
        { entityType: 'DeliveryProof', entityId: 'proof-1' },
        req,
      ),
    ).resolves.toEqual([]);
    expect(processUploadedFilesMock).not.toHaveBeenCalled();
  });

  it('staff can attach to any entity without ownership lookups', async () => {
    const prisma = makePrisma();
    await build(prisma).upload(
      admin,
      [multerFile('doc.jpg')],
      { entityType: 'Incident', entityId: 'inc-1' },
      req,
    );
    expect(prisma.deliveryProof.findUnique).not.toHaveBeenCalled();
    expect(processUploadedFilesMock).toHaveBeenCalledTimes(1);
    expect(prisma.attachment.create).toHaveBeenCalledTimes(1);
  });
});

describe('AttachmentsService.create (metadata)', () => {
  const dto = {
    entityType: 'DeliveryProof',
    entityId: 'proof-9',
    fileName: 'photo.webp',
    fileUrl: 'https://cdn.test/photo.webp',
    fileSize: 10,
    mimeType: 'image/webp',
  };

  // Con un fileUrl libre el conductor podia cerrar la entrega sin subir nada
  // o con la foto publica de otro conductor.
  it.each([
    ['assigned driver', driver],
    ['customer', customer],
  ])('%s gets 403 and nothing is written', async (_label, user) => {
    const prisma = makePrisma({ assignment: true, proofOrderId: 'order-1' });
    prisma.transportOrder.findFirst.mockResolvedValue({ id: 'order-1' });

    const error = await build(prisma)
      .create(user, dto)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      code: 'FORBIDDEN',
      message:
        'Only staff can register attachment metadata; upload the file instead',
    });
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('staff registers the metadata, trimmed and as the uploader', async () => {
    const prisma = makePrisma();
    await build(prisma).create(admin, {
      ...dto,
      entityType: ' Incident ',
      entityId: ' inc-1 ',
      fileUrl: ' https://cdn.test/doc.pdf ',
    });
    expect(prisma.deliveryProof.findUnique).not.toHaveBeenCalled();
    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: {
        entityType: 'Incident',
        entityId: 'inc-1',
        fileName: 'photo.webp',
        fileUrl: 'https://cdn.test/doc.pdf',
        fileSize: 10,
        mimeType: 'image/webp',
        uploadedBy: 'user-1',
        createdAt: expect.any(Date) as unknown,
      },
    });
  });
});

describe('AttachmentsService.list', () => {
  it('staff keeps the free filters (portal drawer)', async () => {
    const prisma = makePrisma();
    await build(prisma).list(admin, 'ORDER', undefined);
    expect(prisma.attachment.findMany).toHaveBeenCalledWith({
      where: { entityType: 'ORDER' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it.each([
    [undefined, undefined],
    ['DeliveryProof', undefined],
    [undefined, 'proof-1'],
  ])(
    'driver/customer without entityType+entityId gets 400 (%s, %s)',
    async (entityType, entityId) => {
      const prisma = makePrisma();
      await expect(
        build(prisma).list(driver, entityType, entityId),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        build(prisma).list(customer, entityType, entityId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.attachment.findMany).not.toHaveBeenCalled();
    },
  );

  it('driver lists the photos of a proof of an assigned order', async () => {
    const prisma = makePrisma({ assignment: true, proofOrderId: 'order-1' });
    await expect(
      build(prisma).list(driver, 'DeliveryProof', 'proof-1'),
    ).resolves.toEqual([{ id: 'att-1' }]);
    expect(prisma.attachment.findMany).toHaveBeenCalledWith({
      where: { entityType: 'DeliveryProof', entityId: 'proof-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('driver still lists the photos of a proof captured by another driver of the same order', async () => {
    // Leer no mira quien capturo: las apps de conductor calculan si la
    // entrega esta lista con todas las pruebas de la orden, como el servidor.
    const prisma = makePrisma({
      assignment: true,
      proofOrderId: 'order-1',
      proofCapturedBy: 'user-previous',
    });
    await expect(
      build(prisma).list(driver, 'DeliveryProof', 'proof-1'),
    ).resolves.toEqual([{ id: 'att-1' }]);
  });

  it('driver cannot list the photos of another driver proof', async () => {
    const prisma = makePrisma({ assignment: false, proofOrderId: 'order-9' });
    await expect(
      build(prisma).list(driver, 'DeliveryProof', 'proof-9'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.attachment.findMany).not.toHaveBeenCalled();
  });

  it('customer lists the photos of the proof of their own order (EvidenceGallery)', async () => {
    const prisma = makePrisma({ proofOrderId: 'order-1' });
    prisma.transportOrder.findFirst.mockResolvedValue({ id: 'order-1' });
    await expect(
      build(prisma).list(customer, 'DeliveryProof', 'proof-1'),
    ).resolves.toEqual([{ id: 'att-1' }]);
  });
});
