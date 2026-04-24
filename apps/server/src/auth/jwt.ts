import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  role: 'admin' | 'staff';
}

export function signAuthToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '12h' });
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}
