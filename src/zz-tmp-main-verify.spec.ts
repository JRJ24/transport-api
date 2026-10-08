import { Body, Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import request from 'supertest';
import { getLocalUploadMount, setLocalUploadHeaders } from '@/common/middlewares/processFile';

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: { items: unknown[] }) {
    return { n: body.items.length };
  }
}
@Module({ controllers: [EchoController] })
class M {}

it('main.ts http setup', async () => {
  process.env.LOCAL_UPLOAD_DIR = process.env.TMP_UPLOADS;
  const app = await NestFactory.create<NestExpressApplication>(M, { logger: false });
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: ['http://portal.test'], credentials: true });
  app.use(helmet());
  const uploads = getLocalUploadMount();
  app.useStaticAssets(uploads.root, { prefix: uploads.prefix, index: false, redirect: false, fallthrough: true, maxAge: '7d', immutable: true, setHeaders: setLocalUploadHeaders });
  app.useBodyParser('json', { limit: '1mb' });
  await app.init();
  const server = app.getHttpServer();
  const img = await request(server).get('/evidences/a.webp').set('Origin', 'http://portal.test');
  console.log('IMG', img.status, img.headers['content-type'], img.headers['cross-origin-resource-policy'], img.headers['cache-control'], img.headers['access-control-allow-origin']);
  const html = await request(server).get('/evidences/old.html');
  console.log('HTML', html.status, html.headers['content-type'], html.headers['content-disposition']);
  const api = await request(server).get('/api/v1/nothing');
  console.log('API404', api.status, api.headers['cross-origin-resource-policy']);
  const items = Array.from({ length: 500 }, (_, i) => ({ latitude: 18.123456789012345, longitude: -69.123456789012345, accuracy: 12.345678901234, speed: 3.21234567, heading: 123.456789, altitude: 45.6789012, recordedAt: new Date().toISOString(), sequence: 1700000000 + i, clientId: '123e4567-e89b-12d3-a456-426614174000' }));
  const big = await request(server).post('/api/v1/echo').send({ items });
  console.log('BATCH', JSON.stringify({ items }).length, big.status, JSON.stringify(big.body));
  const tooBig = await request(server).post('/api/v1/echo').set('Origin', 'http://portal.test').send({ items: [...items, ...items, ...items, ...items] });
  console.log('TOO_BIG', JSON.stringify({ items: [...items, ...items, ...items, ...items] }).length, tooBig.status, tooBig.headers['access-control-allow-origin']);
  const urlenc = await request(server).post('/api/v1/echo').type('form').send('items=1');
  console.log('URLENC', urlenc.status);
  await app.close();
});
