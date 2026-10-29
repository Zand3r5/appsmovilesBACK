import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middlewares/auth';
import { storeImage, uploadDirectory } from '../services/uploads';
export function uploadRoutes(app: Express) {
  app.post('/api/uploads', requireAuth, rateLimit({ windowMs: 60000, limit: 20, message: { error: 'Esperá un momento antes de subir más fotos' } }), async (req, res) => {
    res.status(201).json({ url: await storeImage(req.userId!, req.body?.image) });
  });
  app.use('/media', (req, res, next) => {
    if (!/^\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(req.path)) return res.sendStatus(404);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(uploadDirectory(), { index: false, maxAge: '1y', immutable: true, dotfiles: 'deny' }));
}
