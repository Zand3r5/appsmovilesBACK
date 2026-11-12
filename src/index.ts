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
import { uploadRoutes } from './routes/uploads';
import { cinemaRoutes } from './routes/cinemas';
import { errorHandler } from './middlewares/errors';
export function createApp() {
  validateConfig();
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGINS?.split(',') ?? true }));
  app.use(rateLimit({ windowMs: 60000, limit: 300, message: { error: 'Demasiadas solicitudes' } }));
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/health', async (_req, res) => {
    const sync = await prisma.syncRun.findFirst({ where: { status: 'success' }, orderBy: { id: 'desc' }, select: { finishedAt: true } });
    res.json({ ok: true, catalogLastSyncedAt: sync?.finishedAt ?? null });
  });
  authRoutes(app); movieRoutes(app); releaseRoutes(app); reviewRoutes(app);
  userRoutes(app); socialRoutes(app); rewardRoutes(app); adminRoutes(app);
  cinemaRoutes(app); uploadRoutes(app);
  app.use((_req, res) => res.status(404).json({ error: 'Ruta inexistente' }));
  app.use(errorHandler);
  return app;
}
if (require.main === module) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('API WhatNext lista'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { void prisma.$disconnect(); }));
}
