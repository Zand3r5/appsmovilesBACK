import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

async function readSession(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as jwt.JwtPayload; }
  catch { return null; }
  if (typeof payload.sid !== 'string' || !/^\d+$/.test(payload.sub ?? '')) return null;
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { select: { role: true } } },
  });
  if (!session || session.userId !== Number(payload.sub) || session.expiresAt <= new Date()) return null;
  return session;
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Tu sesión venció, volvé a iniciar sesión' });
    req.userId = session.userId;
    req.sessionId = session.id;
    req.userRole = session.user.role;
    next();
  } catch (e) { next(e); }
}
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await readSession(req);
    if (session) { req.userId = session.userId; req.sessionId = session.id; req.userRole = session.user.role; }
    next();
  } catch (e) { next(e); }
}
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) return res.status(403).json({ error: 'No tenés permiso' });
    next();
  };
}
