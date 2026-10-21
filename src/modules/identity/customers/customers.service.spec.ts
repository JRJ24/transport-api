import type { ConfigType } from '@nestjs/config';
import {
  CREDIT_ACCOUNT_STATUS,
  DOCUMENT_TYPE,
  TYPE_CUSTOMER,
} from '@generated/prisma/enums';
import type { authConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import { CustomersService } from './customers.service';

const companyA = {
  id: 'cust-1',
  userId: 'user-c1',
  customerType: TYPE_CUSTOMER.BUSINESS,
  documentType: DOCUMENT_TYPE.RNC,
  documentNumber: '101000001',
  companyName: 'Empresa A SRL',
  billingEmail: 'facturas@empresa-a.do',
};

function setup(options: {
  credit?: { status: CREDIT_ACCOUNT_STATUS; balanceUsed: number } | null;
  billedPayments?: number;
}) {
  const tx = {
    customerProfile: {
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...companyA, ...data }),
      ),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    customerCreditAccount: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    customerProfile: { findFirst: jest.fn().mockResolvedValue(companyA) },
    customerCreditAccount: {
      findUnique: jest.fn().mockResolvedValue(options.credit ?? null),
    },
    payment: {
      count: jest.fn().mockResolvedValue(options.billedPayments ?? 0),
    },
  };
  const service = new CustomersService(
    prisma as unknown as PrismaService,
    {} as ConfigType<typeof authConfig>,
  );

  return { service, prisma, tx };
}

describe('CustomersService.updateProfile fiscal identity (LOG-API-003)', () => {
  const activeCredit = {
    status: CREDIT_ACCOUNT_STATUS.ACTIVE,
    balanceUsed: 0,
  };

  it('refuses another RNC while the company has an approved credit line', async () => {
    const { service, tx } = setup({ credit: activeCredit });

    await expect(
      service.updateProfile('user-c1', {
        documentNumber: '101000002',
        companyName: 'Empresa B SRL',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.customerProfile.update).not.toHaveBeenCalled();
  });

  it.each([
    ['a pending credit request', CREDIT_ACCOUNT_STATUS.PENDING, 0],
    ['a blocked credit line', CREDIT_ACCOUNT_STATUS.BLOCKED, 0],
    ['a closed line with debt left', CREDIT_ACCOUNT_STATUS.CLOSED, 1200],
  ])('refuses the change with %s', async (_label, status, balanceUsed) => {
    const { service, tx } = setup({ credit: { status, balanceUsed } });

    await expect(
      service.updateProfile('user-c1', { companyName: 'Otra SRL' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.customerProfile.update).not.toHaveBeenCalled();
  });

  it('refuses the change once an order was billed under the document', async () => {
    const { service, tx } = setup({ credit: null, billedPayments: 1 });

    await expect(
      service.updateProfile('user-c1', {
        documentType: DOCUMENT_TYPE.ID,
        documentNumber: '00100000001',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.customerProfile.update).not.toHaveBeenCalled();
  });

  it('refuses switching to individual to drop the credit line', async () => {
    const { service, tx } = setup({ credit: activeCredit });

    await expect(
      service.updateProfile('user-c1', {
        customerType: TYPE_CUSTOMER.INDIVIDUAL,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.customerProfile.update).not.toHaveBeenCalled();
  });

  it('accepts the whole form re-sent unchanged', async () => {
    const { service, tx, prisma } = setup({ credit: activeCredit });

    await service.updateProfile('user-c1', {
      customerType: companyA.customerType,
      documentType: companyA.documentType,
      documentNumber: ` ${companyA.documentNumber} `,
      companyName: companyA.companyName,
      billingEmail: 'nuevo@empresa-a.do',
    });

    expect(prisma.customerCreditAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.customerProfile.update).toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('lets a customer without credit or billing fix the document, with an audit trail', async () => {
    const { service, tx } = setup({ credit: null, billedPayments: 0 });

    await service.updateProfile('user-c1', { documentNumber: '101000009' });

    expect(tx.customerProfile.update).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-c1',
        action: 'CUSTOMER_FISCAL_IDENTITY_UPDATED',
        entityId: 'cust-1',
        oldValues: expect.objectContaining({
          documentNumber: '101000001',
        }) as unknown,
        newValues: expect.objectContaining({
          documentNumber: '101000009',
        }) as unknown,
      }) as unknown,
    });
  });
});
