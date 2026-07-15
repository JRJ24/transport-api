/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NextFunction, Request, Response } from 'express';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

type AttemptBucket = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, AttemptBucket>();

export const loginRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const email =
    typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
  const key = `${req.ip ?? 'unknown'}:${email}`;
  const now = Date.now();
  const bucket = attempts.get(key);

  if (!bucket || bucket.resetAt <= now) {
    attempts.set(key, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    next();
    return;
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    res.status(429).json({
      message: 'Demasiados intentos. Intente nuevamente en un minuto',
    });
    return;
  }

  bucket.count += 1;
  next();
};
