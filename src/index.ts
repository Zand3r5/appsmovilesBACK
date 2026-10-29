import './config';
import { validateConfig } from './config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { prisma } from './prisma';
import { authRoutes } from './routes/auth';
import { movieRoutes } from './routes/movies';
import { releaseRoutes } from './routes/releases';
import { reviewRoutes } from './routes/reviews';
import { userRoutes } from './routes/users';
import { socialRoutes } from './routes/social';
import { rewardRoutes } from './routes/rewards';
import { adminRoutes } from './routes/admin';
import { walletRoutes } from './routes/wallet';
import { uploadRoutes } from './routes/uploads';
import { pushRoutes } from './routes/push';
import { reminderRoutes } from './routes/reminders';
import { cinemaRoutes } from './routes/cinemas';
import { errorHandler } from './middlewares/errors';
export function createApp() {
  validateConfig();
  const app = express();
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGINS?.split(',') ?? true }));
  app.use(rateLimit({ windowMs: 60000, limit: 300, message: { error: 'Demasiadas solicitudes' } }));
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    const sync = await prisma.syncRun.findFirst({ where: { status: 'success' }, orderBy: { id: 'desc' }, select: { finishedAt: true } });
    res.json({ ok: true, catalogLastSyncedAt: sync?.finishedAt ?? null });
  });
  authRoutes(app); movieRoutes(app); releaseRoutes(app); reviewRoutes(app);
  userRoutes(app); socialRoutes(app); rewardRoutes(app); adminRoutes(app);
  reminderRoutes(app); cinemaRoutes(app); pushRoutes(app); uploadRoutes(app); walletRoutes(app);
  app.use((_req, res) => res.status(404).json({ error: 'Ruta inexistente' }));
  app.use(errorHandler);
  return app;
}
if (require.main === module) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('API WhatNext lista'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { void prisma.$disconnect(); }));
}
