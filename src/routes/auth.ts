import type { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middlewares/auth';
import { login, logout, register } from '../services/auth';
import { getSessionUser } from '../services/users';
import { changePassword } from '../services/password';

export function authRoutes(app: Express) {
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Demasiados intentos. Volvé a intentar en unos minutos' } }));
  const passwordLimit = rateLimit({ windowMs: 15 * 60000, limit: 5,
    keyGenerator: req => String(req.userId),
    message: { error: 'Demasiados intentos. Esperá unos minutos antes de volver a intentar' } });
  app.post('/api/auth/change-password', requireAuth, passwordLimit, async (req, res) => {
    res.json(await changePassword(req.userId!, req.sessionId!, req.body));
  });
  app.post('/api/auth/register', async (req, res) => {
    res.status(201).json(await register(req.body));
  });
  app.post('/api/auth/login', async (req, res) => {
    res.json(await login(req.body));
  });
  app.get('/api/auth/me', requireAuth, async (req, res) => res.json(await getSessionUser(req.userId!)));
  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    await logout(req.sessionId!);
    res.status(204).end();
  });
}
