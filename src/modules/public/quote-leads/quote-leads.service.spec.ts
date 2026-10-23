import { ROLES } from '@generated/prisma/enums';
import type { PrismaService } from '@/database/prisma.service';
import type { WhatsAppBusinessService } from '@/integrations/whatsapp/whatsapp-business.service';
import { QuoteLeadsService } from './quote-leads.service';

describe('QuoteLeadsService.ensureCustomerRole (FIA-API-011)', () => {
  it('grants the CUSTOMER role at most once, without read-then-write', async () => {
    const tx = {
      role: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-customer' }),
      },
      userRole: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const service = new QuoteLeadsService(
      {} as PrismaService,
      {} as WhatsAppBusinessService,
    );

    await (
      service as unknown as {
        ensureCustomerRole(client: unknown, userId: string): Promise<void>;
      }
    ).ensureCustomerRole(tx, 'u1');

    expect(tx.role.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: ROLES.CUSTOMER } }),
    );
    expect(tx.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userID: 'u1', roleID: 'role-customer' }],
      skipDuplicates: true,
    });
    expect(tx.userRole.findFirst).not.toHaveBeenCalled();
    expect(tx.userRole.create).not.toHaveBeenCalled();
  });
});
