import type { Express } from 'express';
import { requireAuth } from '../middlewares/auth';
import { movieId } from '../validation/movies';
import { getReleaseReminders, subscribeToRelease, unsubscribeFromRelease } from '../services/reminders';
export function reminderRoutes(app: Express) {
  app.get('/api/reminders', requireAuth, async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await getReleaseReminders(req.userId!)); });
  app.put('/api/reminders/:movieId', requireAuth, async (req, res) => {
    res.json(await subscribeToRelease(req.userId!, movieId(req.params.movieId)));
  });
  app.delete('/api/reminders/:movieId', requireAuth, async (req, res) => {
    await unsubscribeFromRelease(req.userId!, movieId(req.params.movieId));
    res.status(204).end();
  });
}
