import type { Express } from "express";
import { prisma } from "../prisma";
import { optionalAuth, publicUserSelect } from "../middlewares/auth";
import { getOrImportMovie, searchTmdb } from "../services/tmdb";
import { toMovieListDTO } from "../services/movies";
import { getFriendIds } from "../services/social";
import { parseId } from "../utils/validation";
import { handleError } from "../utils/http";

export function movieRoutes(app: Express) {
  app.get("/api/movies", optionalAuth, async (req, res) => {
    try {
      const movies = await prisma.movie.findMany({ where: { hidden: false }, include: { genres: true }, take: 200 });
      const list = await toMovieListDTO(movies, req.userId);
      list.sort((a, b) => (b.communityRating ?? 0) - (a.communityRating ?? 0));    
      res.json(list);
    } catch (e) {
      handleError(res, e);
    }
  });

  //  busca en TMDB (no guarda)
  app.get("/api/movies/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2 || q.length > 80) return res.status(400).json({ error: "Escribí entre 2 y 80 letras" });
    try {
      res.json(await searchTmdb(q));
    } catch (e) {
      handleError(res, e);
    }
  });

  //  (la importa si hace falta)
  app.get("/api/movies/:id", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "El id no es válido" });
    try {
      const movie = await getOrImportMovie(id);
      if (!movie || movie.hidden) return res.status(404).json({ error: "Película no encontrada" });
      const [dto] = await toMovieListDTO([movie], req.userId);

      //  hasta 5 amigos que la reseñaron, para la fila de avatares
      let friendsWhoReviewed: any[] = [];
      if (req.userId) {
        const friendIds = await getFriendIds(req.userId);
        const reviews = await prisma.review.findMany({
          where: { movieId: id, authorId: { in: friendIds } },
          take: 5,
          orderBy: { createdAt: "desc" },
          select: { rating: true, author: { select: publicUserSelect } },
        });
        friendsWhoReviewed = reviews.map((r) => ({ ...r.author, rating: r.rating }));
      }
      res.json({ ...dto, friendsWhoReviewed });
    } catch (e) {
      handleError(res, e);
    }
  });

  
  app.get("/api/movies/:id/recommendations", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "El id no es válido" });
    try {
      const movie = await getOrImportMovie(id);
      if (!movie) return res.status(404).json({ error: "Película no encontrada" });
      const candidates = await prisma.movie.findMany({
        where: {
          id: { not: id },
          hidden: false,
          genres: { some: { id: { in: movie.genres.map((g) => g.id) } } },
        },
        include: { genres: true },
        take: 30,
      });
      const list = await toMovieListDTO(candidates, req.userId);
      list.sort((a, b) => (b.communityRating ?? 0) - (a.communityRating ?? 0));
      res.json(list.slice(0, 6));
    } catch (e) {
      handleError(res, e);
    }
  });
}