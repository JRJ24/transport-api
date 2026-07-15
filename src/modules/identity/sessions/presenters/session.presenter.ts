import type { UserSession } from '@generated/prisma/client';

export interface SessionResponse {
  id: string;
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  ipAddress: string | null;
  lastActivityAt: Date;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
}

export function toSessionResponse(
  session: UserSession,
  currentSessionId?: string,
): SessionResponse {
  return {
    id: session.id,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    platform: session.platform,
    ipAddress: session.ipAddress,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    current: session.id === currentSessionId,
  };
}
