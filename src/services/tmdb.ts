import { prisma } from '../prisma';
const BASE = 'https://api.themoviedb.org/3';
const CREW_JOBS = ['Screenplay', 'Director of Photography', 'Original Music Composer', 'Editor', 'Producer'];
async function tmdb(path: string): Promise<any> {
  if (!process.env.TMDB_KEY) throw new Error('Falta TMDB_KEY en .env');
  const url = new URL((process.env.TMDB_BASE_URL ?? BASE) + path);
  url.searchParams.set('api_key', process.env.TMDB_KEY);
  url.searchParams.set('language', 'es-AR'); url.searchParams.set('region', 'AR');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('TMDB respondió ' + response.status);
  return response.json();
}
const names = (list: any[] = []) => list.map(p => p.provider_name);
export async function importMovieFromTmdb(tmdbId: number) {
  const m = await tmdb(`/movie/${tmdbId}?append_to_response=credits,videos,watch/providers,release_dates`);
  const ar = m['watch/providers']?.results?.AR ?? {};
  const localRelease = m.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'AR')?.release_dates
    ?.filter((r: any) => [2, 3].includes(r.type)).sort((a: any, b: any) => a.release_date.localeCompare(b.release_date))[0]?.release_date?.slice(0, 10);
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
  return prisma.movie.upsert({ where: { tmdbId: m.id }, create: { tmdbId: m.id, ...data, genres: { connectOrCreate: genres } },
    update: { ...data, genres: { set: [], connectOrCreate: genres } }, include: { genres: true } });
}
async function loadList(path: string) {
  const first = await tmdb(`${path}${path.includes('?') ? '&' : '?'}page=1`);
  const maxPages = Number(process.env.TMDB_SYNC_MAX_PAGES ?? 5);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) throw new Error('TMDB_SYNC_MAX_PAGES debe estar entre 1 y 500');
  const rows = [...first.results];
  for (let page = 2; page <= Math.min(first.total_pages, maxPages); page++) rows.push(...(await tmdb(`${path}${path.includes('?') ? '&' : '?'}page=${page}`)).results);
  return [...new Map(rows.map((m: any) => [m.id, m])).values()];
}
// Se ejecuta con catalog:sync; las rutas de la app solo consultan la base.
export async function syncCatalog(report: (message: string) => void = () => {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const future = new Date(Date.now() + 120 * 86400000).toISOString().slice(0,10);
  const lists: Record<string, any[]> = {
    popular: await loadList('/movie/popular'),
    now_playing: await loadList('/movie/now_playing'),
    upcoming: await loadList('/discover/movie?with_release_type=2|3&release_date.gte=' + today + '&release_date.lte=' + future + '&sort_by=primary_release_date.asc'),
  };
  const ids = new Set<number>(Object.values(lists).flatMap(rows => rows.map(movie => movie.id)));
  for (const row of await prisma.movie.findMany({ where: { tmdbId: { not: null } }, select: { tmdbId: true } })) ids.add(row.tmdbId!);
  const mapping = new Map<number, number>();
  for (const id of ids) {
    const movie = await importMovieFromTmdb(id);
    mapping.set(id, movie.id);
    report('Películas actualizadas: ' + mapping.size + '/' + ids.size);
  }
  const entries = Object.entries(lists).flatMap(([kind, rows]) => rows.map((movie, position) => ({ kind, position, movieId: mapping.get(movie.id)!, tmdbRating: movie.vote_average ? movie.vote_average / 2 : null })));
  // Reemplazamos las listas juntas; un fallo de red no debe vaciar los estrenos guardados.
  await prisma.$transaction([prisma.catalogEntry.deleteMany(), prisma.catalogEntry.createMany({ data: entries })]);
  return { imported: mapping.size };
}
