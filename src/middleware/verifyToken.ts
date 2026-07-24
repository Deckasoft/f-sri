import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Missing token' });
  }

  // JWT_SECRET is validated (non-empty) at process startup by loadEnv(); this
  // check only satisfies TypeScript's string | undefined narrowing without a
  // cast, it should never actually throw in a correctly started process.
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ message: 'Server misconfiguration' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    (req as any).user = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

export default verifyToken;
