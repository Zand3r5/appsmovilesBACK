import type { Prisma } from '@prisma/client';
import { prisma } from "../prisma";
import { getFriendsRatings, getFriendIds } from "./social";
import { publicUserSelect } from '../middlewares/auth';
import { fail } from '../utils/http';
import { imageReference } from './uploads';
import { validateMovieInput, type MovieInput } from '../validation/movies';

type MovieRecord = Prisma.MovieGetPayload<{ include: { genres: true } }>;
type MovieStats = { communityRating: number | null; commentsCount: number; ratingsCount: number; reviewsLast30Days: number };
type FriendsRating = { rating: number; count: number };
type MovieMetadata = Pick<MovieInput, 'actors' | 'directors' | 'crew' | 'trailers' | 'watchProviders'>;

const IMG = "https://image.tmdb.org/t/p/";

export async function getMovieStats(movieIds: number[]) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [all, recent] = await Promise.all([
    prisma.review.groupBy({
      by: ["movieId"], where: { movieId: { in: movieIds } },
      _avg: { rating: true }, _count: { _all: true, rating: true },
    }),
    prisma.review.groupBy({
      by: ["movieId"], where: { movieId: { in: movieIds }, createdAt: { gte: since, lte: new Date() } },
      _count: { _all: true },
    }),
  ]);
  const recentMap = new Map(recent.map((r) => [r.movieId, r._count._all]));
  const stats = new Map<number, MovieStats>();
  for (const id of movieIds) stats.set(id, { communityRating: null, commentsCount: 0, ratingsCount: 0, reviewsLast30Days: 0 });
  for (const r of all) {
    stats.set(r.movieId, {
      communityRating: r._avg.rating === null ? null : Math.round(r._avg.rating * 10) / 10,
      commentsCount: r._count._all,
      ratingsCount: r._count.rating,
      reviewsLast30Days: recentMap.get(r.movieId) ?? 0,
    });
  }
  return stats;
}

// La película con la forma que hoy usa la app
export function toMovieDTO(movie: MovieRecord, stats?: MovieStats, friendsRating?: FriendsRating) {
  const meta = JSON.parse(movie.metadata || "{}") as Partial<MovieMetadata>;
  return {
    id: movie.id,
    tmdbId: movie.tmdbId,
    title: movie.title,
    overview: movie.overview,
    releaseDate: movie.releaseDate,
    runtime: movie.runtime,
    genres: (movie.genres ?? []).map(g => g.name),
    posterUrl: movie.posterPath ? (movie.posterPath.startsWith("/") && !movie.posterPath.startsWith("/media/") ? `${IMG}w500${movie.posterPath}` : movie.posterPath) : null,
    backdropUrl: movie.backdropPath ? (movie.backdropPath.startsWith("/") && !movie.backdropPath.startsWith("/media/") ? `${IMG}w1280${movie.backdropPath}` : movie.backdropPath) : null,
    actors: meta.actors ?? [],
    directors: meta.directors ?? [],
    crew: meta.crew ?? [],
    trailers: meta.trailers ?? [],
    watchProviders: meta.watchProviders ?? { AR: { stream: [], rent: [], buy: [] } },
    featured: movie.featured,
    hidden: movie.hidden,
    communityRating: stats?.communityRating ?? null,
    commentsCount: stats?.commentsCount ?? 0,
    ratingsCount: stats?.ratingsCount ?? 0,
    reviewsLast30Days: stats?.reviewsLast30Days ?? 0,
    friendsRating: friendsRating ?? null,
  };
}

export async function toMovieListDTO(movies: MovieRecord[], userId?: number) {
  const ids = movies.map((m) => m.id);
  const [stats, friends] = await Promise.all([getMovieStats(ids), getFriendsRatings(userId, ids)]);
  return movies.map((m) => toMovieDTO(m, stats.get(m.id), friends.get(m.id)));
}
// Catalog rules live here. Routes only validate the request and send the result.
export function compareMovieRatings(a: { communityRating: number | null; title: string; id: number }, b: { communityRating: number | null; title: string; id: number }) {
  return (b.communityRating ?? -1) - (a.communityRating ?? -1) || a.title.localeCompare(b.title, 'es') || a.id - b.id;
}

export async function getMovieCatalog(userId?: number, query?: string) {
  const movies = await prisma.movie.findMany({
    where: { hidden: false, ...(query ? { title: { contains: query } } : {}) }, include: { genres: true },
  });
  return (await toMovieListDTO(movies, userId)).sort(compareMovieRatings);
}

export async function getMovieHome(userId?: number) {
  const list = await getMovieCatalog(userId);
  const featured = list.filter(m => m.featured);
  const rated = list.filter(m => m.communityRating !== null);
  const hero = featured.length ? featured : (rated.length ? rated : list).slice(0, 4);
  const trending = list.filter(m => m.reviewsLast30Days > 0)
    .sort((a, b) => b.reviewsLast30Days - a.reviewsLast30Days || compareMovieRatings(a, b));
  return { list, featured, hero, trending };
}

export async function getMovieDetail(id: number, userId?: number) {
  const movie = await requireSavedMovie(id);
  const [dto] = await toMovieListDTO([movie], userId);
  const friendIds = userId ? await getFriendIds(userId) : [];
  const reviews = friendIds.length ? await prisma.review.findMany({
    where: { movieId: id, authorId: { in: friendIds } }, take: 5, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { rating: true, author: { select: publicUserSelect } },
  }) : [];
  return { ...dto, friendsWhoReviewed: reviews.map(r => ({ ...r.author, rating: r.rating })) };
}

async function requireSavedMovie(id: number) {
  const movie = await prisma.movie.findFirst({ where: { id, hidden: false }, include: { genres: true } });
  if (!movie) fail(404, 'Película no encontrada');
  return movie;
}

export async function getMovieRecommendations(id: number, userId?: number) {
  const movie = await requireSavedMovie(id);
  const candidates = await prisma.movie.findMany({
    where: { id: { not: id }, hidden: false, genres: { some: { id: { in: movie.genres.map(g => g.id) } } } },
    include: { genres: true },
  });
  // Rank the full candidate set before limiting, so the best match cannot be missed.
  return (await toMovieListDTO(candidates, userId)).sort(compareMovieRatings).slice(0, 6);
}

export async function saveMovie(body: unknown, userId: number, id?: number) {
  const input = validateMovieInput(body, id !== undefined);
  if (input.posterUrl !== undefined) input.posterUrl = await imageReference(input.posterUrl, userId, true);
  if (input.backdropUrl !== undefined) input.backdropUrl = await imageReference(input.backdropUrl, userId, true);
  const movie = await prisma.$transaction(async tx => {
    const current = id === undefined ? null : await tx.movie.findUnique({ where: { id } });
    if (id !== undefined && !current) fail(404, 'Película no encontrada');
    const genreIds: number[] = [];
    for (const name of [...new Set(input.genres ?? [])]) {
      let genre = await tx.genre.findFirst({ where: { name } });
      if (!genre) {
        const min = await tx.genre.aggregate({ _min: { id: true } });
        genre = await tx.genre.create({ data: { id: Math.min(0, min._min.id ?? 0) - 1, name } });
      }
      genreIds.push(genre.id);
    }
    const metadata = JSON.parse(current?.metadata || '{}');
    for (const key of ['actors', 'directors', 'crew', 'trailers', 'watchProviders'] as const) {
      if (input[key] !== undefined) metadata[key] = input[key];
    }
    const data = {
      tmdbId: input.tmdbId, title: input.title, overview: input.overview, releaseDate: input.releaseDate,
      runtime: input.runtime, posterPath: input.posterUrl, backdropPath: input.backdropUrl, featured: input.featured,
      metadata: JSON.stringify(metadata),
    };
    if (id === undefined) return tx.movie.create({ data: {
      ...data, title: input.title!, overview: input.overview!, genres: { connect: genreIds.map(id => ({ id })) },
    }, include: { genres: true } });
    return tx.movie.update({ where: { id }, data: {
      ...data, ...(input.genres !== undefined ? { genres: { set: genreIds.map(id => ({ id })) } } : {}),
    }, include: { genres: true } });
  });
  const [dto] = await toMovieListDTO([movie], userId);
  return dto;
}

export async function hideMovie(id: number) {
  // A daily import must not undo moderation or delete reviews.
  await prisma.movie.update({ where: { id }, data: { hidden: true } });
}

export async function getMovieReleases(kind: 'upcoming' | 'now_playing', userId?: number) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const entries = await prisma.catalogEntry.findMany({
    where: { kind, movie: { hidden: false, ...(kind === 'upcoming' ? { releaseDate: { gt: today } } : {}) } },
    include: { movie: { include: { genres: true } } }, orderBy: [{ position: 'asc' }, { movieId: 'asc' }],
  });
  if (kind === 'upcoming') entries.sort((a, b) => a.movie.releaseDate!.localeCompare(b.movie.releaseDate!) || a.position - b.position);
  const movies = await toMovieListDTO(entries.map(e => e.movie), userId);
  return movies.map((movie, i) => ({ ...movie, rating: entries[i].tmdbRating === null ? '-' : Math.round(entries[i].tmdbRating! * 10) / 10 }));
}
