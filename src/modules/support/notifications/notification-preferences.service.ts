import { Injectable } from '@nestjs/common';
import { NOTIFICATION_TYPE } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';

/**
 * Categories whose push cannot be switched off: the customer must always
 * learn that their order moved or that a payment went through, and account
 * security messages are never optional.
 */
export const LOCKED_PUSH_CATEGORIES = new Set<NOTIFICATION_TYPE>([
  NOTIFICATION_TYPE.ORDER_UPDATE,
  NOTIFICATION_TYPE.PAYMENT,
  NOTIFICATION_TYPE.SYSTEM,
]);

export interface NotificationPreferenceView {
  category: NOTIFICATION_TYPE;
  push: boolean;
  email: boolean;
  /** true when push is mandatory for this category. */
  locked: boolean;
}

/**
 * Per-category push opt-outs. In-app notifications are always stored; this
 * only decides whether a push is sent. A category with no row is "on".
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<NotificationPreferenceView[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const byCategory = new Map(rows.map((row) => [row.category, row]));

    return Object.values(NOTIFICATION_TYPE).map((category) => {
      const row = byCategory.get(category);
      const locked = LOCKED_PUSH_CATEGORIES.has(category);
      return {
        category,
        push: locked ? true : (row?.push ?? true),
        email: row?.email ?? true,
        locked,
      };
    });
  }

  async update(
    userId: string,
    items: { category: NOTIFICATION_TYPE; push?: boolean; email?: boolean }[],
  ): Promise<NotificationPreferenceView[]> {
    await this.prisma.$transaction(
      items.map((item) => {
        const push = LOCKED_PUSH_CATEGORIES.has(item.category)
          ? true
          : (item.push ?? true);
        return this.prisma.notificationPreference.upsert({
          where: {
            userId_category: { userId, category: item.category },
          },
          update: {
            push,
            ...(item.email !== undefined && { email: item.email }),
          },
          create: {
            userId,
            category: item.category,
            push,
            email: item.email ?? true,
          },
        });
      }),
    );
    return this.list(userId);
  }

  async allowsPush(
    userId: string,
    category: NOTIFICATION_TYPE,
  ): Promise<boolean> {
    if (LOCKED_PUSH_CATEGORIES.has(category)) {
      return true;
    }
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId_category: { userId, category } },
      select: { push: true },
    });
    return row?.push ?? true;
  }
}
