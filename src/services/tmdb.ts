import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';
const BASE = 'https://api.themoviedb.org/3';
const CREW_JOBS = ['Screenplay', 'Director of Photography', 'Original Music Composer', 'Editor', 'Producer'];
const FESTIVAL = /fest|bafici|ficuba|mar del plata/i;
async function tmdb(path: string): Promise<any> {
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
      return await response.json();
    } catch (e) {
      if (attempt === 2 || (e instanceof Error && e.message.startsWith('TMDB respondió'))) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}
const names = (list: any[] = []) => list.map(p => p.provider_name);
export async function importMovieFromTmdb(tmdbId: number) {
  const m = await tmdb(`/movie/${tmdbId}?append_to_response=credits,videos,watch/providers,release_dates`);
  const ar = m['watch/providers']?.results?.AR ?? {};
  const arReleases = m.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'AR')?.release_dates ?? [];
  const localRelease = arReleases
    .filter((r: any) => [2, 3].includes(r.type)).sort((a: any, b: any) => a.release_date.localeCompare(b.release_date))[0]?.release_date?.slice(0, 10);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const lastCinemaRelease: string | null = arReleases
    .filter((r: any) => [2, 3].includes(r.type) && !FESTIVAL.test(r.note ?? ''))
    .map((r: any) => String(r.release_date).slice(0, 10)).filter((d: string) => d <= today).sort().pop() ?? null;
  const metadata = JSON.stringify({
    actors: (m.credits?.cast ?? []).slice(0, 8).map((c: any) => ({ name: c.name, character: c.character })),
    directors: (m.credits?.crew ?? []).filter((c: any) => c.job === 'Director').map((c: any) => c.name),
    crew: (m.credits?.crew ?? []).filter((c: any) => CREW_JOBS.includes(c.job)).slice(0, 6).map((c: any) => ({ name: c.name, job: c.job })),
    trailers: (m.videos?.results ?? []).filter((v: any) => v.site === 'YouTube' && v.type === 'Trailer').slice(0, 3).map((v: any) => ({ name: v.name, site: 'YouTube', key: v.key })),
    watchProviders: { AR: { stream: names(ar.flatrate), rent: names(ar.rent), buy: names(ar.buy) } },
  });
  const data = { title: m.title, overview: m.overview || '', releaseDate: localRelease || m.release_date || null,
    runtime: m.runtime || null, posterPath: m.poster_path, backdropPath: m.backdrop_path, metadata, syncedAt: new Date() };
  const genres = m.genres.map((g: any) => ({ where: { id: g.id }, create: { id: g.id, name: g.name } }));
  const movie = await prisma.movie.upsert({ where: { tmdbId: m.id }, create: { tmdbId: m.id, ...data, genres: { connectOrCreate: genres } },
    update: { ...data, genres: { set: [], connectOrCreate: genres } }, include: { genres: true } });
  return Object.assign(movie, { lastCinemaRelease });
}
async function loadList(path: string) {
  const first = await tmdb(`${path}${path.includes('?') ? '&' : '?'}page=1`);
  const maxPages = Number(process.env.TMDB_SYNC_MAX_PAGES ?? 5);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) throw new Error('TMDB_SYNC_MAX_PAGES debe estar entre 1 y 500');
  const rows = [...first.results];
  for (let page = 2; page <= Math.min(first.total_pages, maxPages); page++) rows.push(...(await tmdb(`${path}${path.includes('?') ? '&' : '?'}page=${page}`)).results);
  return [...new Map(rows.map((m: any) => [m.id, m])).values()];
}
export async function syncCatalog(report: (message: string) => void = () => {}) {
  report('Iniciando sincronización TMDB…');
  const owner = randomUUID(), name = 'tmdb-catalog';
  const acquired = await prisma.$transaction(async tx => {
    await tx.jobLock.deleteMany({ where: { name, expiresAt: { lt: new Date() } } });
    try { await tx.jobLock.create({ data: { name, owner, expiresAt: new Date(Date.now() + 10 * 60000) } }); return true; }
    catch (e: any) { if (e.code === 'P2002') return false; throw e; }
  });
  if (!acquired) { report('Ya hay una sincronización en curso; no se inició otra.'); return { skipped: true }; }
  const run = await prisma.syncRun.create({ data: {} });
  let lockLost = false;
  const heartbeat = setInterval(() => {
    prisma.jobLock.updateMany({ where: { name, owner }, data: { expiresAt: new Date(Date.now() + 10 * 60000) } })
      .then(r => { if (!r.count) lockLost = true; }).catch(() => { lockLost = true; });
  }, 60000);
  let imported = 0;
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const future = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
    const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
    const load = async (label: string, path: string) => {
      report(`Cargando lista: ${label}…`);
      const rows = await loadList(path);
      report(`${label}: ${rows.length} películas encontradas.`);
      return rows;
    };
    const lists: Record<string, any[]> = {
      popular: await load('Populares', '/movie/popular'),
      now_playing: [...new Map([
        ...await load('Cartelera', '/movie/now_playing'),
        ...await load('Estrenos del último mes', `/discover/movie?with_release_type=2|3&release_date.gte=${monthAgo}&release_date.lte=${today}&sort_by=popularity.desc`),
      ].map(m => [m.id, m])).values()],
      upcoming: await load('Próximas', `/discover/movie?with_release_type=2|3&release_date.gte=${today}&release_date.lte=${future}&sort_by=primary_release_date.asc`),
    };
    const ids = new Set<number>(Object.values(lists).flatMap(rows => rows.map(m => m.id)));
    // Refresh saved TMDB movies as well, preserving reviews and editorial flags.
    const saved = await prisma.movie.findMany({ where: { tmdbId: { not: null } }, select: { tmdbId: true } });
    for (const m of saved) ids.add(m.tmdbId!);
    report(`Actualizando detalles de ${ids.size} películas. Esto puede tardar unos minutos…`);
    const mapping = new Map<number, number>();
    const cinemaRelease = new Map<number, string | null>();
    for (const id of ids) {
      if (lockLost) throw new Error('Se perdió el bloqueo de sincronización');
      const movie = await importMovieFromTmdb(id);
      mapping.set(id, movie.id); cinemaRelease.set(id, movie.lastCinemaRelease); imported++;
      if (imported % 10 === 0 || imported === ids.size) report(`Películas actualizadas: ${imported}/${ids.size}`);
    }
    lists.now_playing = lists.now_playing
      .filter(m => (cinemaRelease.get(m.id) ?? '') >= monthAgo)
      .sort((a, b) => cinemaRelease.get(b.id)!.localeCompare(cinemaRelease.get(a.id)!));
    report(`Cartelera: ${lists.now_playing.length} películas en cines de Argentina en el último mes.`);
    report('Guardando las listas actualizadas…');
    await prisma.$transaction(async tx => {
      const lock = await tx.jobLock.findFirst({ where: { name, owner, expiresAt: { gt: new Date() } } });
      if (!lock || lockLost) throw new Error('Se perdió el bloqueo de sincronización');
      // Only replace membership once every list and movie was successfully fetched.
      await tx.catalogEntry.deleteMany();
      for (const [kind, rows] of Object.entries(lists)) {
        await tx.catalogEntry.createMany({ data: rows.map((m, position) => ({ kind, position, movieId: mapping.get(m.id)!, tmdbRating: m.vote_average ? m.vote_average / 2 : null })) });
      }
      await tx.syncRun.update({ where: { id: run.id }, data: { status: 'success', imported, finishedAt: new Date() } });
    });
    report(`Sincronización completa: ${imported} películas actualizadas.`);
    return { imported };
  } catch (error) {
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'failed', imported, error: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
    throw error;
  } finally {
    clearInterval(heartbeat);
    await prisma.jobLock.deleteMany({ where: { name, owner } });
  }
}
