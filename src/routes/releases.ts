import type { Express } from 'express';
import { optionalAuth } from '../middlewares/auth';
import { getMovieReleases } from '../services/movies';
export function releaseRoutes(app: Express) {
  app.get('/api/releases/upcoming', optionalAuth, async (req, res) => res.json(await getMovieReleases('upcoming', req.userId)));
  app.get('/api/releases/now-playing', optionalAuth, async (req, res) => res.json(await getMovieReleases('now_playing', req.userId)));
}
