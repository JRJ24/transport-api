import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';

interface HealthResponseBody {
  success: boolean;
  data: {
    status: string;
    database: string;
  };
  meta: {
    timestamp: string;
  };
}

describe('Transport API (e2e)', () => {
  let app: INestApplication;
  let httpServer: App;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      'postgresql://postgres:postgres@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET ??=
      'test-access-secret-with-at-least-32-chars';
    process.env.JWT_REFRESH_SECRET ??=
      'test-refresh-secret-with-at-least-32-chars';

    const prismaMock = {
      $queryRaw: (): Promise<{ ok: number }[]> => Promise.resolve([{ ok: 1 }]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    httpServer = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('/api/v1/health (GET)', () => {
    return request(httpServer)
      .get('/api/v1/health')
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as HealthResponseBody;

        expect(body.success).toBe(true);
        expect(body.data.status).toBe('ok');
        expect(body.data.database).toBe('up');
        expect(body.meta.timestamp).toEqual(expect.any(String));
      });
  });
});
