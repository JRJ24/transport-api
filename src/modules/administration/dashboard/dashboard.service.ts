import { Injectable } from '@nestjs/common';
import { STATUS_ORDERS } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const statuses = Object.values(STATUS_ORDERS);
    const [users, drivers, activeDrivers, vehicles, openIncidents] =
      await this.prisma.$transaction([
        this.prisma.user.count(),
        this.prisma.driverProfile.count(),
        this.prisma.driverProfile.count({
          where: { availabilityStatus: 'AVAILABLE' },
        }),
        this.prisma.vehicle.count(),
        this.prisma.incident.count({ where: { status: { not: 'CLOSED' } } }),
      ]);
    const orderCounts = await Promise.all(
      statuses.map((status) =>
        this.prisma.transportOrder.count({ where: { status } }),
      ),
    );
    const ordersByStatus = Object.fromEntries(
      statuses.map((status, index) => [status, orderCounts[index] ?? 0]),
    );

    return {
      users,
      drivers,
      activeDrivers,
      vehicles,
      ordersByStatus,
      openIncidents,
      pendingOrders: ordersByStatus[STATUS_ORDERS.REQUESTED] ?? 0,
    };
  }
}
