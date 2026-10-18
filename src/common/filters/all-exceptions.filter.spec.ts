import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  AnyFilesInterceptor,
  type NestExpressApplication,
} from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { buildEvidenceUploadOptions } from '@/modules/support/attachments/upload-options';
import { ERROR_CODES } from '../constants/error-codes.constant';
import { ApplicationException } from '../exceptions/application.exception';
import { DomainException } from '../exceptions/domain.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Lo que lanzan body-parser/raw-body (http-errors), sin depender del paquete. */
function httpError(
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
): Error {
  return Object.assign(new Error(message), {
    status,
    statusCode: status,
    expose: status < 500,
    ...extra,
  });
}

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('AllExceptionsFilter (unit)', () => {
  function run(exception: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: 'POST',
          url: '/api/v1/tracking/sessions/s1/locations',
          id: 'req-1',
        }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    expect(status).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
    return {
      status: status.mock.calls[0][0] as number,
      body: json.mock.calls[0][0] as {
        success: boolean;
        error: { code: string; message: string; details?: unknown };
        meta: { requestId?: string; path: string };
      },
    };
  }

  describe('http-errors from body-parser (not HttpException)', () => {
    it('PayloadTooLargeError -> 413 BAD_REQUEST with a fixed message, warned and not logged as unhandled', () => {
      const { status, body } = run(
        httpError(413, 'request entity too large', {
          name: 'PayloadTooLargeError',
          type: 'entity.too.large',
          limit: 1048576,
          length: 2000000,
        }),
      );
      expect(status).toBe(413);
      expect(body).toMatchObject({
        success: false,
        error: {
          code: ERROR_CODES.BAD_REQUEST,
          message: 'Request body too large',
        },
        meta: {
          requestId: 'req-1',
          path: '/api/v1/tracking/sessions/s1/locations',
        },
      });
      // Nada de limit/length ni otros campos internos en la respuesta.
      expect(body.error.details).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toBe(
        'POST /api/v1/tracking/sessions/s1/locations rejected with 413 (entity.too.large): request entity too large',
      );
    });

    it('UnsupportedMediaTypeError (charset/encoding) -> 415 BAD_REQUEST', () => {
      const { status, body } = run(
        httpError(415, 'unsupported charset "ISO-8859-1"', {
          type: 'charset.unsupported',
          charset: 'iso-8859-1',
        }),
      );
      expect(status).toBe(415);
      expect(body.error).toEqual({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Unsupported media type',
      });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('another exposed 4xx keeps its status and its (exposable) message', () => {
      const { status, body } = run(
        httpError(400, 'request aborted', { type: 'request.aborted' }),
      );
      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'request aborted',
      });
    });

    it('accepts statusCode alone, like other http-errors producers', () => {
      const error = Object.assign(new Error('too many parameters'), {
        statusCode: 413,
        expose: true,
      });
      const { status, body } = run(error);
      expect(status).toBe(413);
      expect(body.error.code).toBe(ERROR_CODES.BAD_REQUEST);
    });

    it('an exposed 4xx with an empty message falls back to a generic one', () => {
      const { status, body } = run(httpError(409, ''));
      expect(status).toBe(409);
      expect(body.error).toEqual({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Bad request',
      });
    });
  });

  describe('keeps 500 when the error is not a safe client error', () => {
    it.each([
      [
        'a 4xx without expose (e.g. an AxiosError from a provider)',
        Object.assign(new Error('Request failed with status code 404'), {
          status: 404,
        }),
      ],
      ['a 4xx with expose=false', httpError(400, 'x', { expose: false })],
      ['an exposed 5xx', httpError(503, 'down', { expose: true })],
      ['a non-integer status', httpError(413.5, 'x')],
      [
        'a string status',
        Object.assign(new Error('x'), { status: '413', expose: true }),
      ],
      ['a thrown string', 'boom'],
    ])('%s -> 500 INTERNAL_ERROR, logged as unhandled', (_label, exception) => {
      const { status, body } = run(exception);
      expect(status).toBe(500);
      expect(body.error).toEqual({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain(
        'Unhandled exception on POST /api/v1/tracking/sessions/s1/locations',
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('HttpException mapping', () => {
    it('Multer LIMIT_FILE_SIZE (PayloadTooLargeException) -> 413 BAD_REQUEST, no longer INTERNAL_ERROR', () => {
      const { status, body } = run(
        new PayloadTooLargeException('File too large'),
      );
      expect(status).toBe(413);
      expect(body.error).toEqual({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'File too large',
      });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('a 4xx without its own entry maps to BAD_REQUEST', () => {
      const { status, body } = run(new HttpException('Gone', HttpStatus.GONE));
      expect(status).toBe(410);
      expect(body.error).toEqual({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Gone',
      });
    });

    it('a 5xx without its own entry stays INTERNAL_ERROR', () => {
      const { status, body } = run(
        new HttpException('Not implemented', HttpStatus.NOT_IMPLEMENTED),
      );
      expect(status).toBe(501);
      expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });

    it('an explicit code in the body still wins (403 "not yours" convention)', () => {
      const { status, body } = run(
        new ApplicationException(
          ERROR_CODES.FORBIDDEN,
          'La evidencia no es tuya',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(status).toBe(403);
      expect(body.error).toEqual({
        code: ERROR_CODES.FORBIDDEN,
        message: 'La evidencia no es tuya',
      });
    });

    it('class-validator arrays are still VALIDATION_FAILED with details', () => {
      const { status, body } = run(
        new BadRequestException({ message: ['entityId must be a UUID'] }),
      );
      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Validation failed',
        details: ['entityId must be a UUID'],
      });
    });

    it('DomainException is still 422 with its code', () => {
      const { status, body } = run(
        new DomainException(
          ERROR_CODES.DOMAIN_RULE_VIOLATION,
          'Estado invalido',
        ),
      );
      expect(status).toBe(422);
      expect(body.error.code).toBe(ERROR_CODES.DOMAIN_RULE_VIOLATION);
    });
  });
});

@Controller('echo')
class EchoController {
  @Post('json')
  json(@Body() body: unknown): { ok: boolean; body: unknown } {
    return { ok: true, body };
  }

  // Mismas opciones de Multer que POST /attachments/upload (con 1 MB).
  @Post('upload')
  @UseInterceptors(AnyFilesInterceptor(buildEvidenceUploadOptions(1)))
  upload(@UploadedFiles() files: Express.Multer.File[]): { count: number } {
    return { count: files.length };
  }
}

/**
 * Express real con el filtro registrado como en app.module (APP_FILTER) y el
 * parser JSON como en main.ts: el error de body-parser sale del middleware de
 * Express, no de un handler de Nest.
 */
describe('AllExceptionsFilter (body-parser and Multer through Express)', () => {
  jest.setTimeout(30_000);
  let app: NestExpressApplication;
  let server: App;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    app.useBodyParser('json', { limit: '64b' });
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a JSON body over the limit is 413 BAD_REQUEST, not 500', async () => {
    const res = await request(server)
      .post('/echo/json')
      .send({ points: 'x'.repeat(200) })
      .expect(413);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Request body too large',
      },
      meta: { path: '/echo/json' },
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('an unsupported charset is 415 BAD_REQUEST', async () => {
    const res = await request(server)
      .post('/echo/json')
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .send('{"a":1}')
      .expect(415);
    expect(res.body.error).toEqual({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'Unsupported media type',
    });
  });

  it('broken JSON is still a 400 BAD_REQUEST (Nest maps the SyntaxError)', async () => {
    const res = await request(server)
      .post('/echo/json')
      .set('Content-Type', 'application/json')
      .send('{"a":')
      .expect(400);
    expect(res.body.error.code).toBe(ERROR_CODES.BAD_REQUEST);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a body within the limit still works', async () => {
    const res = await request(server)
      .post('/echo/json')
      .send({ a: 1 })
      .expect(201);
    expect(res.body).toEqual({ ok: true, body: { a: 1 } });
  });

  it('an upload over the Multer fileSize limit is 413 BAD_REQUEST, not 500', async () => {
    const res = await request(server)
      .post('/echo/upload')
      .attach('files', Buffer.alloc(1024 * 1024 + 1, 1), {
        filename: 'big.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
    expect(res.body.error).toEqual({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'File too large',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('an upload within the limit reaches the handler', async () => {
    const res = await request(server)
      .post('/echo/upload')
      .attach('files', Buffer.from('jpeg'), {
        filename: 'ok.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect(res.body).toEqual({ count: 1 });
  });
});
