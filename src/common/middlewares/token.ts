/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import type { ROLES } from '@generated/prisma/enums';
import { can, PermissionAction } from '../config/permissions';
import { prisma } from '../../database/prisma';

const revokedTokens = new Set<string>();

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: ROLES;
  active: boolean;
}

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      token?: string;
    }
  }
}

export type AuthRequest<P = Record<string, string>> = Request<P>;

interface IDecodedToken extends jwt.JwtPayload {
  data: {
    _id: string;
  };
}

export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is missing');
  }

  return secret;
};

export const getTokenFromRequest = (req: Request) => {
  const accessToken = req.headers['x-access-token'];

  if (typeof accessToken === 'string') return accessToken;

  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  return undefined;
};

export const revokeJWT = (token: string) => {
  revokedTokens.add(token);
};

export const isJWTRevoked = (token: string) => {
  return revokedTokens.has(token);
};

export const generateJWT = (data: { _id: string }) => {
  return new Promise<string>((resolve, reject) => {
    jwt.sign(
      { data },
      getJwtSecret(),
      {
        algorithm: 'HS256',
        expiresIn: '8h',
      },
      (err, token) => {
        if (err || !token) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject("Couldn't generate token");
        } else {
          resolve(token);
        }
      },
    );
  });
};

export const validatJWT = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const token = getTokenFromRequest(req);

  if (!token || isJWTRevoked(token)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    // const { prisma } = await import("../config/connectionDB");
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as IDecodedToken;

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.data._id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
      },
    });

    if (!user?.active) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    req.user = user;
    req.token = token;
    next();
  } catch (_error) {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

export const requireRole = (...roles: ROLES[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    next();
  };
};

export const requirePermission = (action: PermissionAction) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (!can(req.user.role, action)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    next();
  };
};

export const deleteJWT = async (token: string) => {
  revokeJWT(token);
};