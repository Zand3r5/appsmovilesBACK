import type { Express } from 'express';
import { optionalAuth, requireAuth } from '../middlewares/auth';
import {
  createReview,
  deleteReview,
  listFriendsFeed,
  listPopularReviews,
  listReviews,
  toggleReviewReaction,
  updateReview,
} from '../services/reviews';
import { parseId } from '../utils/validation';

export function reviewRoutes(app: Express) {
  app.get('/api/movies/:id/reviews', optionalAuth, async (req, res) => {
    res.json(await listReviews({ movieId: parseId(req.params.id) ?? 0 }, req.userId));
  });
  app.post('/api/movies/:id/reviews', requireAuth, async (req, res) => {
    try {
      res.status(201).json(await createReview(req.userId!, req.params.id, req.body));
    } catch (error: any) {
      if (error.code === 'P2002') return res.status(409).json({
        error: 'Ya reseñaste esta película. Podés editar tu reseña existente.',
        code: 'REVIEW_ALREADY_EXISTS',
      });
      throw error;
    }
  });
  app.patch('/api/reviews/:id', requireAuth, async (req, res) => {
    res.json(await updateReview(req.userId!, req.params.id, req.body));
  });
  app.delete('/api/reviews/:id', requireAuth, async (req, res) => {
    await deleteReview(req.userId!, req.userRole!, req.params.id);
    res.status(204).end();
  });
  for (const kind of ['like', 'repost'] as const) {
    app.post(`/api/reviews/:id/${kind}`, requireAuth, async (req, res) => {
      res.json(await toggleReviewReaction(req.userId!, req.params.id, kind));
    });
  }
  app.get('/api/feed/popular', optionalAuth, async (req, res) => {
    res.json(await listPopularReviews(req.userId));
  });
  app.get('/api/feed/friends', requireAuth, async (req, res) => {
    res.json(await listFriendsFeed(req.userId!));
  });
}
