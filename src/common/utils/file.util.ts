import { randomUUID } from 'crypto';

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

/**
 * Strips path separators and unsafe characters from a client-provided name.
 */
export function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 180);
}

export function buildStorageKey(prefix: string, fileName: string): string {
  return `${prefix}/${randomUUID()}-${sanitizeFileName(fileName)}`;
}
