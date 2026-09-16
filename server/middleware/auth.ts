/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — JWT authentication middleware.
 * Signs and verifies Bearer tokens. No user registration yet; the token
 * infrastructure is in place for Phase 2 route guards.
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export interface JwtPayload {
  userId: string;
}

// Augment Express Request to carry the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Sign a JWT for a given user ID.
 */
export function createToken(userId: string, jwtSecret: string): string {
  return jwt.sign({ userId } satisfies JwtPayload, jwtSecret, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

/**
 * Express middleware — verify the Bearer token and attach `req.user`.
 * Sends 401 for missing/invalid tokens.
 */
export function createAuthMiddleware(jwtSecret: string) {
  return function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
      });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();

    try {
      const payload = jwt.verify(token, jwtSecret) as JwtPayload;
      req.user = { userId: payload.userId };
      next();
    } catch {
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'Token is expired or invalid.',
      });
    }
  };
}

/**
 * Optional auth — attaches `req.user` if a valid token is present,
 * but never blocks the request. Useful for routes that behave
 * differently for authenticated vs. anonymous users.
 */
export function createOptionalAuthMiddleware(jwtSecret: string) {
  return function optionalAuth(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();

    try {
      const payload = jwt.verify(token, jwtSecret) as JwtPayload;
      req.user = { userId: payload.userId };
    } catch {
      // Ignore — leave req.user undefined.
    }

    next();
  };
}

export { TOKEN_TTL_SECONDS };
