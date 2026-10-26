import { prisma } from "../prisma";
import { fail } from "../utils/http";

const BASE = "https://api.themoviedb.org/3";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;      // una película se refresca si tiene más de 7 días
const CREW_JOBS = ["Screenplay", "Director of Photography", "Original Music Composer", "Editor", "Producer"];

async function tmdb(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}api_key=${process.env.TMDB_KEY}&language=es-AR&region=AR`);
  if (res.status === 404) fail(404, "La película no existe en TMDB");
  if (!res.ok) fail(502, "TMDB no respondió");
  return res.json();
}

const names = (list: any[] = []) => list.map((p) => p.provider_name);

// Trae una película COMPLETA de TMDB y la guarda (la crea o la actualiza)
export async function importMovieFromTmdb(tmdbId: number) {
  const m = await tmdb(`/movie/${tmdbId}?append_to_response=credits,videos,watch/providers`);
  const ar = m["watch/providers"]?.results?.AR ?? {};

  const metadata = JSON.stringify({
    actors: m.credits.cast.slice(0, 8).map((c: any) => ({ name: c.name, character: c.character })),
    directors: m.credits.crew.filter((c: any) => c.job === "Director").map((c: any) => c.name),
    crew: m.credits.crew
      .filter((c: any) => CREW_JOBS.includes(c.job))
      .slice(0, 6)
      .map((c: any) => ({ name: c.name, job: c.job })),
    trailers: m.videos.results
      .filter((v: any) => v.site === "YouTube" && v.type === "Trailer")
      .slice(0, 3)
      .map((v: any) => ({ name: v.name, site: "YouTube", key: v.key })),
    watchProviders: { AR: { stream: names(ar.flatrate), rent: names(ar.rent), buy: names(ar.buy) } },
  });

  const data = {
    title: m.title,
    overview: m.overview || "",
    releaseDate: m.release_date || null,
    runtime: m.runtime || null,
    posterPath: m.poster_path,
    backdropPath: m.backdrop_path,
    metadata,
    syncedAt: new Date(),
  };
  const genres = m.genres.map((g: any) => ({ where: { id: g.id }, create: { id: g.id, name: g.name } }));

  return prisma.movie.upsert({
    where: { id: m.id },
    create: { id: m.id, ...data, genres: { connectOrCreate: genres } },
    update: { ...data, genres: { set: [], connectOrCreate: genres } },
    include: { genres: true },
  });
}

// Devuelve la película de la base; si no está o quedó vieja, la trae de TMDB
export async function getOrImportMovie(id: number) {
  const movie = await prisma.movie.findUnique({ where: { id }, include: { genres: true } });
  const stale = !movie || Date.now() - movie.syncedAt.getTime() > MAX_AGE_MS;
  if (!stale) return movie;
  try {
    return await importMovieFromTmdb(id);
  } catch (e) {
    if (movie) return movie;         
    throw e;
  }
}

// ---- Listas que NO se guardan: se recuerdan unas horas en memoria ----
const cache = new Map<string, { at: number; data: any }>();

async function cached(key: string, ttlMs: number, load: () => Promise<any>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

const toListItem = (m: any) => ({
  id: m.id,
  title: m.title,
  overview: m.overview,
  releaseDate: m.release_date,
  posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
  rating: m.vote_average === 0 ? "-" : Number((m.vote_average / 2).toFixed(1)),
});

const SIX_HOURS = 6 * 60 * 60 * 1000;

export const getNowPlaying = () =>
  cached("now_playing", SIX_HOURS, async () => (await tmdb("/movie/now_playing?page=1")).results.map(toListItem));

export const getUpcoming = () =>
  cached("upcoming", SIX_HOURS, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const list = (await tmdb("/movie/upcoming?page=1")).results.map(toListItem);
    return list
      .filter((m: any) => m.releaseDate && m.releaseDate > today)
      .sort((a: any, b: any) => a.releaseDate.localeCompare(b.releaseDate));
  });

export const searchTmdb = (q: string) =>
  cached(`search:${q.toLowerCase()}`, 60 * 60 * 1000, async () =>
    (await tmdb(`/search/movie?query=${encodeURIComponent(q)}&page=1`)).results.slice(0, 20).map(toListItem));

// Sincroniza el catálogo con lo vigente (al arrancar el servidor)
export async function syncCatalog() {
  const [popular, nowPlaying] = await Promise.all([tmdb("/movie/popular?page=1"), tmdb("/movie/now_playing?page=1")]);
  const ids = [...new Set([...popular.results, ...nowPlaying.results].map((m: any) => m.id))];
  for (const id of ids) {
    try { await importMovieFromTmdb(id); } catch { /* si una falla, se sigue con las demás */ }
  }
  console.log(`Catálogo sincronizado: ${ids.length} películas`);
}