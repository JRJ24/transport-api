import { ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
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
