import { parseId } from '../utils/validation';
import { fail } from '../utils/http';
export type MovieInput = {
  title: string; overview: string; tmdbId?: number | null; releaseDate: string; runtime: number;
  genres: string[]; actors: Array<{ name: string; character: string }>; directors: string[];
  crew: Array<{ name: string; job: string }>; trailers: Array<{ name: string; key: string; site: 'YouTube' }>;
  watchProviders: { AR: { stream: string[]; rent: string[]; buy: string[] } };
  posterUrl: string | null; backdropUrl?: string | null; featured: boolean;
};
const keys = ['title','overview','tmdbId','releaseDate','runtime','genres','actors','directors','crew','trailers','watchProviders','posterUrl','backdropUrl','featured'];
function text(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}
function strings(value: unknown, max: number, length: number): value is string[] {
  return Array.isArray(value) && value.length <= length && value.every(item => text(item, max, 1));
}
export function validateMovieInput(body: unknown, partial = false): Partial<MovieInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Película inválida');
  const data = { ...body } as any;
  if (!Object.keys(data).length || Object.keys(data).some(key => !keys.includes(key))) fail(400, 'Campos de película inválidos');
  if (!partial && ['title','overview','releaseDate','runtime','genres','posterUrl'].some(key => data[key] === undefined)) fail(400, 'Completá los datos de la película');
  if (data.title !== undefined) { if (!text(data.title, 200, 1)) fail(400, 'Título inválido'); data.title = data.title.trim(); }
  if (data.overview !== undefined) { if (!text(data.overview, 10000, 1)) fail(400, 'Sinopsis inválida'); data.overview = data.overview.trim(); }
  if (data.tmdbId !== undefined && data.tmdbId !== null && (!Number.isInteger(data.tmdbId) || data.tmdbId <= 0)) fail(400, 'TMDB id inválido');
  if (data.releaseDate !== undefined) {
    const date = new Date(data.releaseDate);
    if (typeof data.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.releaseDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== data.releaseDate) fail(400, 'Fecha inválida');
  }
  if (data.runtime !== undefined) { data.runtime = Number(data.runtime); if (!Number.isInteger(data.runtime) || data.runtime <= 0 || data.runtime > 2000) fail(400, 'Duración inválida'); }
  if (data.genres !== undefined && (!strings(data.genres, 80, 20) || !data.genres.length)) fail(400, 'Géneros inválidos');
  for (const key of ['posterUrl','backdropUrl']) {
    const value = data[key];
    if (value !== undefined && value !== null && (!text(value, 1500000) || !(/^\/media\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(value) || /^https?:\/\//.test(value) || /^data:image\/(jpeg|jpg|png);base64,/.test(value)))) fail(400, 'Imagen inválida');
  }
  if (data.featured !== undefined && typeof data.featured !== 'boolean') fail(400, 'Destacada inválida');
  if (data.directors !== undefined && !strings(data.directors, 150, 20)) fail(400, 'Directores inválidos');
  for (const key of ['actors','crew']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 50 || data[key].some((item: any) => !item || !text(item.name,150,1) || !text(item[key === 'actors' ? 'character' : 'job'],150)))) fail(400, 'Personas inválidas');
  }
  if (data.trailers !== undefined && (!Array.isArray(data.trailers) || data.trailers.length > 10 || data.trailers.some((item: any) => !item || !text(item.name,150) || typeof item.key !== 'string' || !/^[\w-]{11}$/.test(item.key) || item.site !== 'YouTube'))) fail(400, 'Tráiler inválido');
  if (data.watchProviders !== undefined) {
    const ar = data.watchProviders?.AR;
    if (!ar || !['stream','rent','buy'].every(key => strings(ar[key],100,50))) fail(400, 'Proveedores inválidos');
  }
  if (!partial) {
    data.actors ??= []; data.directors ??= []; data.crew ??= []; data.trailers ??= [];
    data.watchProviders ??= { AR: { stream: [], rent: [], buy: [] } }; data.featured ??= false;
  }
  return data;
}
export function movieSearchQuery(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) fail(400, 'Escribí entre 1 y 80 caracteres');
  return value.trim();
}
export function movieId(value: unknown) {
  const id = parseId(value);
  if (!id) fail(400, 'El id no es válido');
  return id;
}
