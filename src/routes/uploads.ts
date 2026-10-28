import type { Express } from 'express';
import express from 'express';

import { requireAuth } from '../middlewares/auth';
import { storeImage, uploadDirectory } from '../services/uploads';
export function uploadRoutes(app: Express) {
  app.post('/api/uploads', requireAuth, async (req, res) => {
    res.status(201).json({ url: await storeImage(req.userId!, req.body?.image) });
  });
  app.use('/media', (req, res, next) => {
    if (!/^\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(req.path)) return res.sendStatus(404);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(uploadDirectory(), { index: false, maxAge: '1y', immutable: true, dotfiles: 'deny' }));
}
