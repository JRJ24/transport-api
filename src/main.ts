import { ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import {
  getLocalUploadMount,
  resolveStorageTarget,
  setLocalUploadHeaders,
} from './common/middlewares/processFile';
import { appConfig } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // One hop: the nginx in front sets X-Forwarded-For. Without this every
  // request presents the proxy's address, so rate limiting buckets the whole
  // tenant together and the access logs are useless.
  app.set('trust proxy', 1);

  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  app.setGlobalPrefix(config.apiPrefix);

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  app.use(helmet());

  // Uploads en disco local (STORAGE_DRIVER=local, o spaces sin bucket): se
  // sirven en la misma ruta con la que processFile arma la URL, fuera del
  // prefijo api/v1. Va despues de helmet para que setLocalUploadHeaders pueda
  // relajar Cross-Origin-Resource-Policy solo en esta ruta.
  const uploads = getLocalUploadMount();
  app.useStaticAssets(uploads.root, {
    prefix: uploads.prefix,
    index: false,
    redirect: false,
    fallthrough: true,
    // Las claves son unicas (uuid o timestamp) y no se sobrescriben.
    maxAge: '7d',
    immutable: true,
    setHeaders: setLocalUploadHeaders,
  });
  // Avisa al arrancar (una sola vez) si falta el bucket y se usara disco.
  resolveStorageTarget();

  // El default de Express es 100kb y un lote de tracking de 500 puntos
  // (el maximo del DTO) pasa de eso: daba 413 antes de validar. Despues de
  // CORS, como el parser que Nest registra por defecto (y que ya no agrega),
  // para que un 413 o un JSON roto sigan llevando los headers CORS.
  app.useBodyParser('json', { limit: '1mb' });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );

  app.enableShutdownHooks();

  if (config.swaggerEnabled && config.nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('RUTA RD Transport API')
      .setDescription(
        'API del monolito modular de RUTA RD: identidad, transporte, operaciones, tracking, facturación, soporte y administración.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(config.port);
}

void bootstrap();
