import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const databaseConfig = registerAs('database', () => ({
  url: env().DATABASE_URL,
}));
