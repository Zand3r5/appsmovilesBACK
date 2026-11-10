import type { Express } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth';
import { saveMovie, hideMovie } from '../services/movies';
import { requireId } from '../validation/movies';

export function adminRoutes(app: Express) {
  app.post('/api/movies', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.status(201).json(await saveMovie(req.body, req.userId!));
  });
  app.patch('/api/movies/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.json(await saveMovie(req.body, req.userId!, requireId(req.params.id)));
  });
  app.delete('/api/movies/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    await hideMovie(requireId(req.params.id));
    res.status(204).end();
  });
}
