import type { Express } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth';
import { createMovie, hideMovie, updateMovie } from '../services/movies';
import { requireId } from '../utils/validation';

export function adminRoutes(app: Express) {
  app.post('/api/movies', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.status(201).json(await createMovie(req.body, req.userId!));
  });
  app.patch('/api/movies/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.json(await updateMovie(requireId(req.params.id), req.body, req.userId!));
  });
  app.delete('/api/movies/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    await hideMovie(requireId(req.params.id));
    res.status(204).end();
  });
}
