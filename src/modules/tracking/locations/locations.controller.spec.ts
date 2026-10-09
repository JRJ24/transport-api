import {
  type CanActivate,
  type ExecutionContext,
  Global,
  type INestApplication,
  Injectable,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { RolesGuard } from '@/common/guards/roles.guard';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { EvidenceAccessService } from '@/modules/support/evidence-access/evidence-access.service';
import { LocationsController } from './locations.controller';
import { LocationsModule } from './locations.module';
import { LocationsService } from './locations.service';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = 'owner-user';
const DRIVER_ID = 'driver-user';

/**
 * Hace de JwtAuthGuard: el usuario sale de las cabeceras x-user / x-role
 * (roles separados por coma).
 */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: unknown;
    }>();
    if (!req.headers.authorization) {
      throw new UnauthorizedException();
    }
    req.user = {
      id: req.headers['x-user'] ?? 'someone',
      roles: (req.headers['x-role'] ?? 'DRIVER').split(','),
    };
    return true;
  }
}

/**
 * Base simulada: la orden es de OWNER_ID y DRIVER_ID tiene una asignacion en
 * `assignmentStatus`. Las consultas responden como Postgres al filtro que
 * llega, asi se comprueba tambien que estados pide EvidenceAccessService.
 */
function makePrisma(assignmentStatus: string | null) {
  return {
    orderAssignment: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: {
            orderId: string;
            driver: { userId: string };
            assignmentStatus: { in: string[] };
          };
        }) =>
          Promise.resolve(
            where.orderId === ORDER_ID &&
              where.driver.userId === DRIVER_ID &&
              assignmentStatus !== null &&
              where.assignmentStatus.in.includes(assignmentStatus)
              ? { id: 'asg-1' }
              : null,
          ),
      ),
    },
    transportOrder: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; customer: { userId: string } } }) =>
          Promise.resolve(
            where.id === ORDER_ID && where.customer.userId === OWNER_ID
              ? { id: ORDER_ID }
              : null,
          ),
      ),
    },
    driverLocation: {
      findMany: jest.fn().mockResolvedValue([{ id: 'loc-1' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'loc-1' }),
    },
  };
}

type FakePrisma = ReturnType<typeof makePrisma>;

async function createApp(prisma: FakePrisma) {
  const moduleRef = await Test.createTestingModule({
    controllers: [LocationsController],
    providers: [
      LocationsService,
      EvidenceAccessService,
      { provide: PrismaService, useValue: prisma },
      { provide: RealtimeService, useValue: {} },
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

const ROUTES = [
  ['GET /locations/orders/:orderId', `/locations/orders/${ORDER_ID}`, 'findMany'],
  [
    'GET /locations/orders/:orderId/latest',
    `/locations/orders/${ORDER_ID}/latest`,
    'findFirst',
  ],
] as const;

describe.each(ROUTES)('%s (order ownership)', (_label, url, query) => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function call(
    user: string,
    roles: string,
    assignmentStatus: string | null = null,
  ) {
    const prisma = makePrisma(assignmentStatus);
    app = await createApp(prisma);
    const res = await request(app.getHttpServer() as App)
      .get(url)
      .set('Authorization', 'Bearer t')
      .set('x-user', user)
      .set('x-role', roles);
    return { res, prisma };
  }

  it.each(['ADMIN', 'OPERATOR'])(
    '%s reads any order without an ownership query (portal)',
    async (role) => {
      const { res, prisma } = await call('staff-user', role);

      expect(res.status).toBe(200);
      expect(prisma.driverLocation[query]).toHaveBeenCalledTimes(1);
      expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
      expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
    },
  );

  it('the customer who owns the order reads it (customer live map)', async () => {
    const { res, prisma } = await call(OWNER_ID, 'CUSTOMER');

    expect(res.status).toBe(200);
    expect(prisma.transportOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_ID, customer: { userId: OWNER_ID } },
      }),
    );
    expect(prisma.driverLocation[query]).toHaveBeenCalledTimes(1);
  });

  it.each(['PENDING', 'ACCEPTED', 'COMPLETED'])(
    'the driver with a %s assignment reads it',
    async (status) => {
      const { res, prisma } = await call(DRIVER_ID, 'DRIVER', status);

      expect(res.status).toBe(200);
      expect(prisma.driverLocation[query]).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['another customer', 'intruder', 'CUSTOMER', null],
    ['another driver', 'intruder', 'DRIVER', null],
    ['a driver whose assignment was REJECTED', DRIVER_ID, 'DRIVER', 'REJECTED'],
    ['a driver whose assignment was CANCELLED', DRIVER_ID, 'DRIVER', 'CANCELLED'],
    ['a customer+driver with no tie to the order', 'intruder', 'CUSTOMER,DRIVER', null],
  ])(
    '%s gets 403 FORBIDDEN and no location query runs',
    async (_who, user, roles, status) => {
      const { res, prisma } = await call(user, roles, status);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You cannot access this order' },
      });
      expect(prisma.driverLocation.findMany).not.toHaveBeenCalled();
      expect(prisma.driverLocation.findFirst).not.toHaveBeenCalled();
    },
  );
});

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: RealtimeService, useValue: {} },
  ],
  exports: [PrismaService, RealtimeService],
})
class FakeGlobalsModule {}

describe('LocationsModule wiring', () => {
  it('resolves LocationsController with the shared EvidenceAccessService', async () => {
    // Sin EvidenceAccessModule en imports Nest no resuelve el segundo
    // argumento del controller y la app no arranca.
    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalsModule, LocationsModule],
    }).compile();

    expect(moduleRef.get(LocationsController)).toBeInstanceOf(
      LocationsController,
    );
    await moduleRef.close();
  });
});
