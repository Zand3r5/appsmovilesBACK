import type { Express } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth';
import { createMovie, updateMovie, hideMovie } from '../services/movies';
import { movieId } from '../validation/movies';
export function adminRoutes(app: Express) {
  app.post('/api/movies', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.status(201).json(await createMovie(req.body, req.userId!));
  });
  app.patch('/api/movies/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.json(await updateMovie(req.body, req.userId!, movieId(req.params.id)));
  });
  app.delete('/api/movies/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    await hideMovie(movieId(req.params.id));
    res.status(204).end();
  });
}
