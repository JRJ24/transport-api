import { registerAs } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  driver: process.env.STORAGE_DRIVER ?? 'spaces',
  bucket: process.env.SPACES_BUCKET ?? process.env.S3_BUCKET ?? '',
  region: process.env.SPACES_REGION ?? process.env.S3_REGION ?? 'nyc3',
  endpoint: process.env.SPACES_ENDPOINT ?? process.env.S3_ENDPOINT ?? '',
  publicUrl: process.env.SPACES_PUBLIC_URL ?? '',
  uploadPrefix: process.env.SPACES_UPLOAD_PREFIX ?? 'evidences',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 50),
}));
