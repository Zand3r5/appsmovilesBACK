import type { Express } from 'express';
import { optionalAuth, requireAuth, requireRole } from '../middlewares/auth';
import { listReviews } from '../services/reviews';
import {
  getPublicProfile,
  getUserReposts,
  listUsers,
  updateCurrentUser,
  updateUserRole,
} from '../services/users';
import { requireId } from '../utils/validation';

export function userRoutes(app: Express) {
  app.patch('/api/users/me', requireAuth, async (req, res) => {
    res.json(await updateCurrentUser(req.userId!, req.sessionId!, req.body));
  });
  app.get('/api/users', requireAuth, requireRole('superadmin'), async (_req, res) => {
    res.json(await listUsers());
  });
  app.patch('/api/users/:id/role', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.json(await updateUserRole(req.userId!, requireId(req.params.id), req.body?.role));
  });
  app.get('/api/users/me', requireAuth, async (req, res) => {
    res.json(await getPublicProfile(req.userId!, req.userId));
  });
  app.get('/api/users/:id', optionalAuth, async (req, res) => {
    res.json(await getPublicProfile(requireId(req.params.id), req.userId));
  });
  app.get('/api/users/:id/reviews', optionalAuth, async (req, res) => {
    res.json(await listReviews({ authorId: requireId(req.params.id) }, req.userId));
  });
  app.get('/api/users/:id/reposts', optionalAuth, async (req, res) => {
    res.json(await getUserReposts(requireId(req.params.id), req.userId));
  });
}
