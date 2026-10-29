import type { Express } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { prisma } from '../prisma';
import { requireAuth, createSession, sessionUser } from '../middlewares/auth';
import { cleanEmail, cleanText, isBcryptPassword, isStrongPassword } from '../utils/validation';
import { fail } from '../utils/http';
import { changePassword } from '../services/password';

export function authRoutes(app: Express) {
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Demasiados intentos. Volvé a intentar en unos minutos' } }));
  const passwordLimit = rateLimit({ windowMs: 15 * 60000, limit: 5,
    keyGenerator: req => String(req.userId),
    message: { error: 'Demasiados intentos. Esperá unos minutos antes de volver a intentar' } });
  app.post('/api/auth/change-password', requireAuth, passwordLimit, async (req, res) => {
    res.json(await changePassword(req.userId!, req.sessionId!, req.body?.currentPassword, req.body?.newPassword));
  });
  app.post('/api/auth/register', async (req, res) => {
    const name = cleanText(req.body?.name, 60), email = cleanEmail(req.body?.email), password = req.body?.password;
    if (!name || !email || !isStrongPassword(password)) fail(400, 'Ingresá un nombre, email y contraseña de al menos 8 caracteres con letras y números y hasta 72 bytes UTF-8');
    const exists = await prisma.user.findUnique({ where: { email: email! } });
    if (exists) fail(409, 'Ya existe una cuenta con ese email. Iniciá sesión');
    const user = await prisma.user.create({ data: { name: name!, email: email!, passwordHash: await bcrypt.hash(password, 10) } });
    res.status(201).json({ token: await createSession(user.id), user: await sessionUser(user.id) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const email = cleanEmail(req.body?.email), password = req.body?.password;
    if (!email || !isBcryptPassword(password)) fail(400, 'Completá email y contraseña (máximo 72 bytes UTF-8)');
    const user = await prisma.user.findUnique({ where: { email: email! } });
    if (!user || !await bcrypt.compare(password, user.passwordHash)) fail(401, 'Email o contraseña incorrectos');
    res.json({ token: await createSession(user.id), user: await sessionUser(user.id) });
  });
  app.get('/api/auth/me', requireAuth, async (req, res) => res.json(await sessionUser(req.userId!)));
  app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!isBcryptPassword(currentPassword) || !currentPassword || !isStrongPassword(newPassword)) fail(400, 'Ingresá la contraseña actual y una nueva de al menos 8 caracteres con letras y números y hasta 72 bytes UTF-8');
    if (currentPassword === newPassword) fail(400, 'La nueva contraseña debe ser diferente de la actual');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) fail(400, 'La contraseña actual es incorrecta');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction(async tx => {
      // Compare-and-swap prevents concurrent password changes using stale credentials.
      const changed = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash } });
      if (!changed.count) fail(409, 'La contraseña cambió. Volvé a intentarlo');
      const session = await tx.session.findUnique({ where: { id: req.sessionId! } });
      if (!session || session.userId !== user.id || session.expiresAt <= new Date()) fail(401, 'Tu sesión venció, volvé a iniciar sesión');
      await tx.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId! } } });
    });
    res.json({ message: 'Contraseña actualizada. Se cerraron las sesiones en los demás dispositivos.' });
  });
  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    await prisma.session.deleteMany({ where: { id: req.sessionId } });
    res.status(204).end();
  });
}
