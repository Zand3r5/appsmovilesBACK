import type { Express } from 'express';
import { optionalAuth } from '../middlewares/auth';
import { getMovieCatalog, getMovieHome, getMovieDetail, getMovieRecommendations } from '../services/movies';
import { movieSearchQuery, movieId } from '../validation/movies';
export function movieRoutes(app: Express) {
  app.get('/api/movies', optionalAuth, async (req, res) => res.json(await getMovieCatalog(req.userId)));
  app.get('/api/movies/home', optionalAuth, async (req, res) => res.json(await getMovieHome(req.userId)));
  app.get('/api/movies/search', optionalAuth, async (req, res) => {
    res.json(await getMovieCatalog(req.userId, movieSearchQuery(req.query.q)));
  });
  app.get('/api/movies/:id', optionalAuth, async (req, res) => res.json(await getMovieDetail(movieId(req.params.id), req.userId)));
  app.get('/api/movies/:id/recommendations', optionalAuth, async (req, res) => {
    res.json(await getMovieRecommendations(movieId(req.params.id), req.userId));
  });
}
