import type { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middlewares/auth';
import { getNearbyCinemas } from '../services/cinemas';
export function cinemaRoutes(app: Express) {
  const limit = rateLimit({ windowMs: 60000, limit: 30, message: { error: 'Esperá un momento antes de volver a buscar cines' } });
  app.post('/api/cinemas/nearby', requireAuth, limit, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getNearbyCinemas(req.body));
  });
}
