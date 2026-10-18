import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import { EvidenceAccessService } from '../evidence-access/evidence-access.service';
import { IncidentsController } from './incidents.controller';
import { INCIDENT_LIST_DENIED, IncidentsService } from './incidents.service';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const INCIDENT_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Hace de JwtAuthGuard: pone en req.user el rol que pide la cabecera x-role,
 * para ver que el controller le pasa ese usuario al servicio.
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
    req.user = { id: 'user-1', roles: [req.headers['x-role'] ?? 'DRIVER'] };
    return true;
  }
}

async function createApp(
  providers: Parameters<typeof Test.createTestingModule>[0]['providers'],
) {
  const moduleRef = await Test.createTestingModule({
    controllers: [IncidentsController],
    providers: [
      ...(providers ?? []),
      { provide: APP_GUARD, useClass: FakeAuthGuard },
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

describe('IncidentsController (user is passed to the service)', () => {
  let app: INestApplication;
  let server: App;
  const service = {
    list: jest.fn(),
    create: jest.fn(),
    addComment: jest.fn(),
    updateStatus: jest.fn(),
    escalate: jest.fn(),
  };

  beforeAll(async () => {
    app = await createApp([{ provide: IncidentsService, useValue: service }]);
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.list.mockReset().mockResolvedValue([]);
    service.addComment.mockReset().mockResolvedValue({ id: 'com-1' });
    service.escalate.mockReset().mockResolvedValue({ id: INCIDENT_ID });
  });

  it('GET /incidents hands the authenticated user and the query to list()', async () => {
    await request(server)
      .get('/incidents')
      .query({ orderId: ORDER_ID })
      .set('Authorization', 'Bearer t')
      .set('x-role', 'CUSTOMER')
      .expect(200);

    expect(service.list).toHaveBeenCalledTimes(1);
    const [user, query] = service.list.mock.calls[0] as [
      { id: string; roles: string[] },
      Record<string, unknown>,
    ];
    expect(user).toEqual({ id: 'user-1', roles: ['CUSTOMER'] });
    expect({ ...query }).toEqual({ orderId: ORDER_ID });
  });

  it('POST /incidents/:id/comments hands the user, the id and the comment', async () => {
    await request(server)
      .post(`/incidents/${INCIDENT_ID}/comments`)
      .set('Authorization', 'Bearer t')
      .send({ comment: 'Hola' })
      .expect(201);

    const [user, id, dto] = service.addComment.mock.calls[0] as [
      { id: string },
      string,
      Record<string, unknown>,
    ];
    expect(user.id).toBe('user-1');
    expect(id).toBe(INCIDENT_ID);
    expect({ ...dto }).toEqual({ comment: 'Hola' });
  });

  it.each([
    // Lo que manda el portal: escalateIncident(id, reason) -> { reason } o {}.
    ['{ reason }', { reason: 'Cliente no responde' }, 'Cliente no responde'],
    ['{}', {}, undefined],
  ])(
    'PATCH /incidents/:id/escalate with %s reaches the service as before',
    async (_label, body, reason) => {
      await request(server)
        .patch(`/incidents/${INCIDENT_ID}/escalate`)
        .set('Authorization', 'Bearer t')
        .set('x-role', 'OPERATOR')
        .send(body)
        .expect(200);

      expect(service.escalate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', roles: ['OPERATOR'] }),
        INCIDENT_ID,
        reason,
      );
    },
  );

  it('PATCH /incidents/:id/escalate without a body still escalates (no reason)', async () => {
    await request(server)
      .patch(`/incidents/${INCIDENT_ID}/escalate`)
      .set('Authorization', 'Bearer t')
      .set('x-role', 'OPERATOR')
      .expect(200);

    expect(service.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      INCIDENT_ID,
      undefined,
    );
  });

  it.each([
    ['a non-string reason', { reason: 5 }],
    ['an unknown field', { reason: 'x', severity: 'CRITICAL' }],
  ])(
    'PATCH /incidents/:id/escalate with %s is a 400 and never reaches the service',
    async (_label, body) => {
      // Antes el body no tenia clase: { reason: 5 } llegaba a reason.trim()
      // y respondia 500; un campo extra se ignoraba sin avisar.
      const res = await request(server)
        .patch(`/incidents/${INCIDENT_ID}/escalate`)
        .set('Authorization', 'Bearer t')
        .set('x-role', 'OPERATOR')
        .send(body)
        .expect(400);

      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED', message: 'Validation failed' },
      });
      expect(service.escalate).not.toHaveBeenCalled();
    },
  );
});

describe('IncidentsController + IncidentsService (HTTP envelope)', () => {
  let app: INestApplication;
  let server: App;
  const prisma = {
    incident: { findMany: jest.fn().mockResolvedValue([]) },
    orderAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    transportOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  beforeAll(async () => {
    app = await createApp([
      IncidentsService,
      EvidenceAccessService,
      { provide: PrismaService, useValue: prisma },
      { provide: RealtimeService, useValue: {} },
      { provide: NotificationDispatcherService, useValue: {} },
    ]);
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.incident.findMany.mockClear();
  });

  it('a driver without orderId gets 400 BAD_REQUEST and nothing is listed', async () => {
    const res = await request(server)
      .get('/incidents')
      .set('Authorization', 'Bearer t')
      .set('x-role', 'DRIVER')
      .expect(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'orderId is required' },
    });
    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });

  it('a customer asking for a foreign order gets 403 FORBIDDEN', async () => {
    const res = await request(server)
      .get('/incidents')
      .query({ orderId: ORDER_ID })
      .set('Authorization', 'Bearer t')
      .set('x-role', 'CUSTOMER')
      .expect(403);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN', message: INCIDENT_LIST_DENIED },
    });
    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });

  it('the portal (OPERATOR) still lists with free filters and no orderId', async () => {
    await request(server)
      .get('/incidents')
      .query({ status: 'OPEN', search: 'ORD' })
      .set('Authorization', 'Bearer t')
      .set('x-role', 'OPERATOR')
      .expect(200);
    expect(prisma.incident.findMany).toHaveBeenCalledTimes(1);
  });
});
