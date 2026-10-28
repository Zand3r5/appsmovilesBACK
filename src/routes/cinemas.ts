import type { Express } from 'express';

import { requireAuth } from '../middlewares/auth';
import { getNearbyCinemas } from '../services/cinemas';
export function cinemaRoutes(app: Express) {
  app.post('/api/cinemas/nearby', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getNearbyCinemas(req.body));
  });
}
