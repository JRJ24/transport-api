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
  opts: { assignment?: boolean; proofOrderId?: string } = {},
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
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.proofOrderId ? { orderId: opts.proofOrderId } : null,
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

  it('without entity it only stores the file (attachment null) for any authenticated user', async () => {
    const prisma = makePrisma();

    const result = await build(prisma).upload(
      customer,
      [multerFile('photo.jpg')],
      {},
      req,
    );

    expect(processUploadedFilesMock).toHaveBeenCalledTimes(1);
    expect(prisma.deliveryProof.findUnique).not.toHaveBeenCalled();
    expect(result).toEqual([{ file: stored('photo.jpg'), attachment: null }]);
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

  it('a driver cannot attach metadata to a proof of an order not assigned to them', async () => {
    const prisma = makePrisma({ assignment: false, proofOrderId: 'order-9' });
    await expect(build(prisma).create(driver, dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('an assigned driver can', async () => {
    const prisma = makePrisma({ assignment: true, proofOrderId: 'order-1' });
    await build(prisma).create(driver, dto);
    expect(prisma.attachment.create).toHaveBeenCalledTimes(1);
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
