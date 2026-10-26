
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";

export function signToken(userId: number) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET!, { expiresIn: "7d" });
}


function readUserId(header?: string): number | null | undefined {
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as jwt.JwtPayload;
    return Number(payload.sub);
  } catch {
    return undefined;
  }
}

// La ruta exige sesión
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = readUserId(req.headers.authorization);
  if (userId === null) return res.status(401).json({ error: "Iniciá sesión para continuar" });
  if (userId === undefined) return res.status(401).json({ error: "Tu sesión venció, volvé a iniciar sesión" });
  req.userId = userId;
  next();
}

// La ruta funciona con o sin sesión (para saber si "yo" le di like a algo)
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const userId = readUserId(req.headers.authorization);
  if (typeof userId === "number") req.userId = userId;
  next();
}

// La ruta exige un rol. El rol se lee de la BASE, no del token.
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { role: true } });
      if (!user || !roles.includes(user.role)) return res.status(403).json({ error: "No tenés permiso" });
      next();
    } catch {
      res.status(500).json({ error: "Error inesperado" });
    }
  };
}

export const publicUserSelect = { id: true, name: true, role: true } as const;