import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';

export async function createSession(userId: number) {
  const id = randomUUID();
  await prisma.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + 7 * 86400000) } });
  return jwt.sign({ sub: String(userId), sid: id }, process.env.JWT_SECRET!, { expiresIn: '7d', algorithm: 'HS256' });
}
async function readSession(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as jwt.JwtPayload; }
  catch { return null; }
  if (typeof payload.sid !== 'string' || !/^\d+$/.test(payload.sub ?? '')) return null;
  const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
  if (!session || session.userId !== Number(payload.sub) || session.expiresAt <= new Date()) return null;
  return session;
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Tu sesión venció, volvé a iniciar sesión' });
    req.userId = session.userId;
    req.sessionId = session.id;
    next();
  } catch (e) { next(e); }
}
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await readSession(req);
    if (session) { req.userId = session.userId; req.sessionId = session.id; }
    next();
  } catch (e) { next(e); }
}
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { role: true } });
      if (!user || !roles.includes(user.role)) return res.status(403).json({ error: 'No tenés permiso' });
      next();
    } catch (e) { next(e); }
  };
}
export const publicUserSelect = { id: true, name: true, role: true } as const;
export async function sessionUser(id: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: {
    id: true, name: true, email: true, role: true,
    likes: { select: { reviewId: true } }, reposts: { select: { reviewId: true } },
  } });
  return { ...user, likes: user.likes.map(x => x.reviewId), reposts: user.reposts.map(x => x.reviewId) };
}
