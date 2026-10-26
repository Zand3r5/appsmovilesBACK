import type { Express } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../prisma";
import { requireAuth, signToken } from "../middlewares/auth";
import { cleanEmail, cleanText, isStrongPassword } from "../utils/validation";
import { handleError } from "../utils/http";

const sessionUser = (u: { id: number; name: string; email: string; role: string }) => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
});


export function authRoutes(app: Express) {
  app.post("/api/auth/register", async (req, res) => {
    const name = cleanText(req.body?.name, 60);
    const email = cleanEmail(req.body?.email);
    const password = req.body?.password;
    if (!name) return res.status(400).json({ error: "Falta el nombre" });
    if (!email) return res.status(400).json({ error: "El email no es válido" });
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: "La contraseña necesita 8 caracteres, con letras y números" });
    }
    try {
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) return res.status(409).json({ error: "Ya existe una cuenta con ese email" });
      const user = await prisma.user.create({
        data: { name, email, passwordHash: await bcrypt.hash(password, 10) },   // role: el default "user"
      });
      res.status(201).json({ token: signToken(user.id), user: sessionUser(user) });
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== "string") {
      return res.status(400).json({ error: "Completá email y contraseña" });
    }
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      const ok = user && (await bcrypt.compare(password, user.passwordHash));
      if (!user || !ok) return res.status(401).json({ error: "Email o contraseña incorrectos" });
      res.json({ token: signToken(user.id), user: sessionUser(user) });
    } catch (e) {
      handleError(res, e);
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.userId! } });
      if (!user) return res.status(401).json({ error: "La cuenta ya no existe" });
      res.json(sessionUser(user));
    } catch (e) {
      handleError(res, e);
    }
  });
}