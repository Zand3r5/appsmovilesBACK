import { prisma } from "../prisma";
import { getFriendsRatings } from "./social";

const IMG = "https://image.tmdb.org/t/p/";

export async function getMovieStats(movieIds: number[]) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [all, recent] = await Promise.all([
    prisma.review.groupBy({
      by: ["movieId"], where: { movieId: { in: movieIds } },
      _avg: { rating: true }, _count: { _all: true },
    }),
    prisma.review.groupBy({
      by: ["movieId"], where: { movieId: { in: movieIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  const recentMap = new Map(recent.map((r) => [r.movieId, r._count._all]));
  const stats = new Map<number, { communityRating: number | null; commentsCount: number; reviewsLast30Days: number }>();
  for (const id of movieIds) stats.set(id, { communityRating: null, commentsCount: 0, reviewsLast30Days: 0 });
  for (const r of all) {
    stats.set(r.movieId, {
      communityRating: r._avg.rating === null ? null : Math.round(r._avg.rating * 10) / 10,
      commentsCount: r._count._all,
      reviewsLast30Days: recentMap.get(r.movieId) ?? 0,
    });
  }
  return stats;
}

// La película con la forma que hoy usa la app
export function toMovieDTO(movie: any, stats?: any, friendsRating?: any) {
  const meta = JSON.parse(movie.metadata || "{}");
  return {
    id: movie.id,
    tmdbId: movie.id,
    title: movie.title,
    overview: movie.overview,
    releaseDate: movie.releaseDate,
    runtime: movie.runtime,
    genres: (movie.genres ?? []).map((g: any) => g.name),
    posterUrl: movie.posterPath ? `${IMG}w500${movie.posterPath}` : null,
    backdropUrl: movie.backdropPath ? `${IMG}w1280${movie.backdropPath}` : null,
    actors: meta.actors ?? [],
    directors: meta.directors ?? [],
    crew: meta.crew ?? [],
    trailers: meta.trailers ?? [],
    watchProviders: meta.watchProviders ?? { AR: { stream: [], rent: [], buy: [] } },
    featured: movie.featured,
    hidden: movie.hidden,
    communityRating: stats?.communityRating ?? null,
    commentsCount: stats?.commentsCount ?? 0,
    reviewsLast30Days: stats?.reviewsLast30Days ?? 0,
    friendsRating: friendsRating ?? null,                    // D.7
  };
}

export async function toMovieListDTO(movies: any[], userId?: number) {
  const ids = movies.map((m) => m.id);
  const [stats, friends] = await Promise.all([getMovieStats(ids), getFriendsRatings(userId, ids)]);
  return movies.map((m) => toMovieDTO(m, stats.get(m.id), friends.get(m.id)));
}