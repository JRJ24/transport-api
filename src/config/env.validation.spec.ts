import { envSchema } from './env.validation';

/** Lo minimo que exige el esquema para arrancar. */
const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('envSchema PUBLIC_API_BASE_URL', () => {
  it('is optional: an environment without it (every current deployment) still validates', () => {
    const result = envSchema.safeParse({
      ...base,
      // Lo que manda docker-compose en produccion.
      NODE_ENV: 'production',
      GOOGLE_MAPS_SERVER_API_KEY: 'key',
      PAYMENT_CALLBACK_BASE_URL: 'https://api.larutard.com.do/api/v1',
    });
    expect(result.success).toBe(true);
    expect(result.data?.PUBLIC_API_BASE_URL).toBeUndefined();
  });

  it.each([['https://api.larutard.com.do'], ['http://192.168.1.10:3000/api/v1']])(
    'accepts the http(s) URL %s',
    (value) => {
      const result = envSchema.safeParse({ ...base, PUBLIC_API_BASE_URL: value });
      expect(result.success).toBe(true);
      expect(result.data?.PUBLIC_API_BASE_URL).toBe(value);
    },
  );

  it('an empty value (copied from .env.example) counts as unset, not as an error', () => {
    const result = envSchema.safeParse({ ...base, PUBLIC_API_BASE_URL: '  ' });
    expect(result.success).toBe(true);
    expect(result.data?.PUBLIC_API_BASE_URL).toBe('');
  });

  it.each([['api.larutard.com.do'], ['javascript:alert(1)'], ['ftp://x.test']])(
    'rejects %s at startup instead of silently ignoring it',
    (value) => {
      const result = envSchema.safeParse({ ...base, PUBLIC_API_BASE_URL: value });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['PUBLIC_API_BASE_URL']);
    },
  );
});
