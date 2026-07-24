import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const BEARER_PREFIX = 'Bearer ';

const adminTokenSchema = z.object({
  userId: z.string(),
  role: z.literal('admin'),
});

const extractBearerToken = (req: Request): string | undefined => {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith(BEARER_PREFIX)) {
    return authorization.slice(BEARER_PREFIX.length);
  }
  return undefined;
};

/**
 * Authenticates /admin/api/* requests via a JWT signed by
 * src/routes/admin/auth.ts's login endpoint, requiring role === 'admin'.
 * On success, populates req.auth with the resolved admin user.
 */
export const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ message: 'Missing token' });
    return;
  }

  // JWT_SECRET is validated (non-empty) at process startup by loadEnv(); this
  // check only satisfies TypeScript's string | undefined narrowing without a
  // cast, it should never actually throw in a correctly started process.
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    res.status(500).json({ message: 'Server misconfiguration' });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const parsed = adminTokenSchema.safeParse(decoded);
    if (!parsed.success) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    req.auth = { kind: 'admin', userId: parsed.data.userId };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

export default adminAuth;
