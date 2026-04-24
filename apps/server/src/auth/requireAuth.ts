import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from './jwt.js';

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: number;
    username: string;
    role: 'admin' | 'staff';
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = verifyAuthToken(token);
    req.auth = {
      userId: Number(payload.sub),
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.auth?.role !== 'admin') {
    res.status(403).json({ error: 'admin access required' });
    return;
  }

  next();
}
