import { registerAs } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  driver: process.env.STORAGE_DRIVER ?? 's3',
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
}));
