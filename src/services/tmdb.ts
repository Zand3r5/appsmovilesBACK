import { z } from 'zod';
import { prisma } from '../prisma';
import { movieMetadataSchema } from '../validation/movies';

const BASE = 'https://api.themoviedb.org/3';
const CREW_JOBS = ['Screenplay', 'Director of Photography', 'Original Music Composer', 'Editor', 'Producer'];
const FESTIVAL = /fest|bafici|ficuba|mar del plata/i;

const tmdbListMovieSchema = z.object({
  id: z.number().int().positive(),
  vote_average: z.number().nullable().optional(),
});

const tmdbListSchema = z.object({
  total_pages: z.number().int().nonnegative(),
  results: z.array(tmdbListMovieSchema),
});

const providerSchema = z.object({ provider_name: z.string() });
const tmdbMovieSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  overview: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  runtime: z.number().int().nonnegative().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  genres: z.array(z.object({ id: z.number().int(), name: z.string() })),
  credits: z.object({
    cast: z.array(z.object({ name: z.string(), character: z.string().nullable().optional() })),
    crew: z.array(z.object({ name: z.string(), job: z.string() })),
  }).optional(),
  videos: z.object({
    results: z.array(z.object({ name: z.string(), site: z.string(), type: z.string(), key: z.string() })),
  }).optional(),
  'watch/providers': z.object({
    results: z.object({
      AR: z.object({
        flatrate: z.array(providerSchema).optional(),
        rent: z.array(providerSchema).optional(),
        buy: z.array(providerSchema).optional(),
      }).optional(),
    }),
  }).optional(),
  release_dates: z.object({
    results: z.array(z.object({
      iso_3166_1: z.string(),
      release_dates: z.array(z.object({
        type: z.number().int(),
        note: z.string().nullable().optional(),
        release_date: z.string(),
      })),
    })),
  }).optional(),
});

type TmdbListMovie = z.infer<typeof tmdbListMovieSchema>;
type TmdbProvider = z.infer<typeof providerSchema>;

async function tmdb<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  if (!process.env.TMDB_KEY) throw new Error('Falta TMDB_KEY en backend/.env');
  const url = new URL(`${process.env.TMDB_BASE_URL ?? BASE}${path}`);
  url.searchParams.set('api_key', process.env.TMDB_KEY);
  url.searchParams.set('language', 'es-AR');
  url.searchParams.set('region', 'AR');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, Math.min(Number(response.headers.get('retry-after') ?? 2), 30) * 1000));
          continue;
        }
        throw new Error(`TMDB respondió ${response.status} para ${url.pathname}`);
      }
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new Error(`TMDB respondió datos inválidos para ${url.pathname}`);
      return parsed.data;
    } catch (e) {
      if (attempt === 2 || (e instanceof Error && e.message.startsWith('TMDB respondió'))) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error('TMDB no respondió');
}
const names = (list: TmdbProvider[] = []) => list.map(provider => provider.provider_name);

async function saveTmdbGenres(genres: { id: number; name: string }[]) {
  const connections: { id: number }[] = [];
  for (const incoming of genres) {
    const byTmdbId = await prisma.genre.findUnique({ where: { tmdbId: incoming.id } });
    const genre = byTmdbId
      ? await prisma.genre.update({ where: { id: byTmdbId.id }, data: { name: incoming.name } })
      : await prisma.genre.upsert({
          where: { name: incoming.name },
          create: { tmdbId: incoming.id, name: incoming.name },
          update: { tmdbId: incoming.id },
        });
    connections.push({ id: genre.id });
  }
  return connections;
}

async function importMovieFromTmdb(tmdbId: number, upcoming = false) {
  const m = await tmdb(`/movie/${tmdbId}?append_to_response=credits,videos,watch/providers,release_dates`, tmdbMovieSchema);
  const ar = m['watch/providers']?.results?.AR ?? {};
  const arReleases = m.release_dates?.results.find(result => result.iso_3166_1 === 'AR')?.release_dates ?? [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const theatricalDates: string[] = arReleases
    .filter(release => [2, 3].includes(release.type) && !FESTIVAL.test(release.note ?? ''))
    .map(release => release.release_date.slice(0, 10)).sort();
  // Upcoming discovery includes re-releases: keep the relevant future Argentine
  // date rather than filtering the movie out because of its original premiere.
  const localRelease = (upcoming ? theatricalDates.find(date => date > today) : undefined) ?? theatricalDates[0];
  const lastCinemaRelease: string | null = arReleases
    .filter(release => [2, 3].includes(release.type) && !FESTIVAL.test(release.note ?? ''))
    .map(release => release.release_date.slice(0, 10)).filter(date => date <= today).sort().pop() ?? null;
  const metadata = JSON.stringify(movieMetadataSchema.parse({
    actors: (m.credits?.cast ?? []).slice(0, 8).map(actor => ({ name: actor.name, character: actor.character ?? '' })),
    directors: (m.credits?.crew ?? []).filter(member => member.job === 'Director').map(member => member.name),
    crew: (m.credits?.crew ?? []).filter(member => CREW_JOBS.includes(member.job)).slice(0, 6).map(member => ({ name: member.name, job: member.job })),
    trailers: (m.videos?.results ?? []).filter(video => video.site === 'YouTube' && video.type === 'Trailer').slice(0, 3).map(video => ({ name: video.name, site: 'YouTube', key: video.key })),
    watchProviders: { AR: { stream: names(ar.flatrate), rent: names(ar.rent), buy: names(ar.buy) } },
  }));
  const data = { title: m.title, overview: m.overview || '', releaseDate: localRelease || m.release_date || null,
    runtime: m.runtime || null, posterPath: m.poster_path, backdropPath: m.backdrop_path, metadata, syncedAt: new Date() };
  const genres = await saveTmdbGenres(m.genres);
  const movie = await prisma.movie.upsert({ where: { tmdbId: m.id }, create: { tmdbId: m.id, ...data, genres: { connect: genres } },
    update: { ...data, genres: { set: genres } }, include: { genres: true } });
  return Object.assign(movie, { lastCinemaRelease });
}
async function loadList(path: string) {
  const first = await tmdb(`${path}${path.includes('?') ? '&' : '?'}page=1`, tmdbListSchema);
  const maxPages = Number(process.env.TMDB_SYNC_MAX_PAGES ?? 5);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) throw new Error('TMDB_SYNC_MAX_PAGES debe estar entre 1 y 500');
  const rows = [...first.results];
  for (let page = 2; page <= Math.min(first.total_pages, maxPages); page++) {
    rows.push(...(await tmdb(`${path}${path.includes('?') ? '&' : '?'}page=${page}`, tmdbListSchema)).results);
  }
  return [...new Map(rows.map(movie => [movie.id, movie])).values()];
}

type CatalogLists = Record<'popular' | 'now_playing' | 'upcoming', TmdbListMovie[]>;
type Report = (message: string) => void;

async function loadCatalogLists(report: Report) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const future = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const load = async (label: string, path: string) => {
    report(`Cargando lista: ${label}…`);
    const rows = await loadList(path);
    report(`${label}: ${rows.length} películas encontradas.`);
    return rows;
  };
  const lists: CatalogLists = {
    popular: await load('Populares', '/movie/popular'),
    now_playing: [...new Map([
      ...await load('Cartelera', '/movie/now_playing'),
      ...await load('Estrenos del último mes', `/discover/movie?with_release_type=2|3&release_date.gte=${monthAgo}&release_date.lte=${today}&sort_by=popularity.desc`),
    ].map(movie => [movie.id, movie])).values()],
    upcoming: await load('Próximas', `/discover/movie?with_release_type=2|3&release_date.gte=${today}&release_date.lte=${future}&sort_by=primary_release_date.asc`),
  };
  return { lists, monthAgo };
}

async function movieIdsToSync(lists: CatalogLists) {
  const ids = new Set(Object.values(lists).flatMap(rows => rows.map(movie => movie.id)));
  const saved = await prisma.movie.findMany({ where: { tmdbId: { not: null } }, select: { tmdbId: true } });
  for (const movie of saved) ids.add(movie.tmdbId!);
  return ids;
}

async function saveCatalog(lists: CatalogLists, movieIds: Map<number, number>, runId: number, imported: number) {
  await prisma.$transaction(async tx => {
    // Replace the visible catalog only after every TMDB request succeeded.
    await tx.catalogEntry.deleteMany();
    for (const [kind, rows] of Object.entries(lists)) {
      await tx.catalogEntry.createMany({
        data: rows.map((movie, position) => ({
          kind, position, movieId: movieIds.get(movie.id)!,
          tmdbRating: movie.vote_average ? movie.vote_average / 2 : null,
        })),
      });
    }
    await tx.syncRun.update({ where: { id: runId }, data: { status: 'success', imported, finishedAt: new Date() } });
  });
}

export async function syncCatalog(report: (message: string) => void = () => {}) {
  report('Iniciando sincronización TMDB…');
  const run = await prisma.syncRun.create({ data: {} });
  let imported = 0;
  try {
    const { lists, monthAgo } = await loadCatalogLists(report);
    const ids = await movieIdsToSync(lists);
    report(`Actualizando detalles de ${ids.size} películas. Esto puede tardar unos minutos…`);
    const mapping = new Map<number, number>();
    const cinemaRelease = new Map<number, string | null>();
    const upcomingIds = new Set(lists.upcoming.map(movie => movie.id));
    for (const id of ids) {
      const movie = await importMovieFromTmdb(id, upcomingIds.has(id));
      mapping.set(id, movie.id); cinemaRelease.set(id, movie.lastCinemaRelease); imported++;
      if (imported % 10 === 0 || imported === ids.size) report(`Películas actualizadas: ${imported}/${ids.size}`);
    }
    lists.now_playing = lists.now_playing
      .filter(m => (cinemaRelease.get(m.id) ?? '') >= monthAgo)
      .sort((a, b) => cinemaRelease.get(b.id)!.localeCompare(cinemaRelease.get(a.id)!));
    report(`Cartelera: ${lists.now_playing.length} películas en cines de Argentina en el último mes.`);
    report('Guardando las listas actualizadas…');
    await saveCatalog(lists, mapping, run.id, imported);
    report(`Sincronización completa: ${imported} películas actualizadas.`);
    return { imported };
  } catch (error) {
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'failed', imported, error: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
    throw error;
  }
}
