import { z } from 'zod';
import { prisma } from '../prisma';
import { fail } from '../utils/http';
import { getCinemaDirectory, inArgentinaRegion } from './cinemaDirectory';
export const cinemaQuery = z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(1000).max(50000).default(15000),
}).strict();
const cinema = z.object({ id: z.string(), name: z.string(), address: z.string().nullable(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export type SavedCinema = z.infer<typeof cinema>;
const TTL = 6 * 3600000, MAX_STALE = 24 * 3600000;
type Lookup = { data: SavedCinema[]; fetchedAt: Date; provider: 'openstreetmap' | 'sinca'; dataYear: number | null; stale: boolean };
const snapshot = z.object({ data: z.array(cinema), provider: z.enum(['openstreetmap', 'sinca']), dataYear: z.number().nullable(), stale: z.boolean().default(false) });
const pending = new Map<string, Promise<Lookup>>();
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (n: number) => n * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
async function queryOverpass(lat: number, lng: number, radiusM: number): Promise<SavedCinema[]> {
  const query = `[out:json][timeout:6];nwr["amenity"="cinema"](around:${radiusM},${lat},${lng});out center tags;`;
  const endpoints = process.env.OVERPASS_URL
    ? [process.env.OVERPASS_URL]
    : ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  // Leave time for the directory fallback before the app's 20-second HTTP deadline.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  async function ask(url: string, useGet = false): Promise<SavedCinema[]> {
    const endpoint = new URL(url);
    if (useGet) endpoint.searchParams.set('data', query);
    const response = await fetch(endpoint, {
      method: useGet ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'WhatNext/1.0' },
      body: useGet ? undefined : `data=${encodeURIComponent(query)}`, signal: controller.signal,
    });
    if (!response.ok) throw new Error('Overpass no respondió');
    const body = await response.json() as { elements?: unknown[]; remark?: string };
    if (!Array.isArray(body.elements) || body.remark) throw new Error('Respuesta de cines incompleta');
    const rows: SavedCinema[] = [];
    for (const value of body.elements) {
      const el = value as any;
      if (!['node', 'way', 'relation'].includes(el?.type) || !Number.isInteger(el.id)) continue;
      const tags = el.tags ?? {};
      const address = [tags['addr:street'], tags['addr:housenumber']].filter(x => typeof x === 'string').join(' ');
      const parsed = cinema.safeParse({ id: `${el.type}/${el.id}`, name: tags.name ?? 'Cine sin nombre', address: address || null, lat: el.lat ?? el.center?.lat, lng: el.lon ?? el.center?.lon });
      if (parsed.success) rows.push(parsed.data);
    }
    // A non-empty but entirely invalid payload must not win the provider race.
    if (body.elements.length && !rows.length) throw new Error('Respuesta de cines inválida');
    return [...new Map(rows.map(c => [c.id, c])).values()];
  }
  async function askNominatim(urlValue: string): Promise<SavedCinema[]> {
    const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
    const url = new URL(urlValue);
    for (const [key, value] of Object.entries({
      format: 'jsonv2', amenity: 'cinema', limit: '40', bounded: '1', addressdetails: '1',
      viewbox: [lng - dLng, lat + dLat, lng + dLng, lat - dLat].join(','),
    })) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { 'User-Agent': 'WhatNext/1.0', 'Accept-Language': 'es' }, signal: controller.signal });
    if (!response.ok) throw new Error('Nominatim no respondió');
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('Respuesta de cines incompleta');
    const rows: SavedCinema[] = [];
    for (const el of body as any[]) {
      if (!['node', 'way', 'relation'].includes(el?.osm_type) || !Number.isInteger(el.osm_id)) continue;
      const address = [el.address?.road, el.address?.house_number].filter(x => typeof x === 'string').join(' ');
      if (!el.lat || !el.lon) continue;
      const parsed = cinema.safeParse({ id: `${el.osm_type}/${el.osm_id}`, name: el.name || 'Cine sin nombre', address: address || null, lat: Number(el.lat), lng: Number(el.lon) });
      if (parsed.success) rows.push(parsed.data);
    }
    // A geocoder is not an exhaustive POI source: an empty response must not hide cinemas.
    if (!rows.length) throw new Error('Sin resultados del proveedor alternativo');
    return [...new Map(rows.map(c => [c.id, c])).values()];
  }
  try {
    const providers = endpoints.map(url => ask(url).catch(error => {
      if (controller.signal.aborted) throw error;
      return ask(url, true);
    }));
    // Support an explicitly configured provider, without adding a public geocoder by default.
    if (process.env.NOMINATIM_URL) providers.push(askNominatim(process.env.NOMINATIM_URL));
    return await Promise.any(providers);
  } catch {
    fail(503, 'No pudimos consultar los cines. Intentá de nuevo en unos minutos');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
async function fetchAndCache(key: string, lat: number, lng: number, radiusM: number, preferStale = false) {
  let data: SavedCinema[], provider: Lookup['provider'] = 'openstreetmap', dataYear: number | null = null;
  let fetchedAt = new Date(), stale = false;
  try { data = await queryOverpass(lat, lng, radiusM + 1000); }
  catch (error) {
    if (preferStale || !inArgentinaRegion(lat, lng)) throw error;
    try {
      const directory = await getCinemaDirectory();
      // Save only this area's results; the national snapshot has its own cache entry.
      data = directory.data.filter(c => distanceKm(lat, lng, c.lat, c.lng) <= (radiusM + 1000) / 1000);
      if (!data.length) throw error; // No directory coverage is not evidence that no cinemas exist.
      provider = 'sinca'; dataYear = directory.dataYear; fetchedAt = directory.fetchedAt; stale = directory.stale;
    } catch { throw error; }
  }
  const expiresAt = new Date(Date.now() + TTL);
  const saved = JSON.stringify({ data, provider, dataYear, stale });
  await prisma.cinemaLookup.upsert({ where: { key }, create: { key, data: saved, fetchedAt, expiresAt }, update: { data: saved, fetchedAt, expiresAt } });
  const areas = { key: { not: { startsWith: 'directory:' } } };
  await prisma.cinemaLookup.deleteMany({ where: { ...areas, fetchedAt: { lt: new Date(Date.now() - MAX_STALE) } } });
  const excess = await prisma.cinemaLookup.findMany({ where: areas, orderBy: [{ fetchedAt: 'desc' }, { key: 'asc' }], skip: 1000, select: { key: true } });
  if (excess.length) await prisma.cinemaLookup.deleteMany({ where: { key: { in: excess.map(c => c.key) } } });
  return { data, fetchedAt, provider, dataYear, stale };
}

export async function getNearbyCinemas(body: unknown) {
  const parsed = cinemaQuery.safeParse(body);
  if (!parsed.success) fail(400, 'Ubicación o radio inválido. El radio debe estar entre 1 y 50 km');
  const { lat, lng, radiusM } = parsed.data;
  // Reuse an area cache without storing an account's precise GPS coordinates.
  const centerLat = Number(lat.toFixed(2)), centerLng = Number(lng.toFixed(2));
  const key = `v2:${centerLat.toFixed(2)}:${centerLng.toFixed(2)}:${radiusM}`;
  const row = await prisma.cinemaLookup.findUnique({ where: { key } });
  let cached: z.infer<typeof snapshot> | null = null;
  try { if (row) cached = snapshot.parse(JSON.parse(row.data)); } catch { /* replace corrupt cached data */ }
  let data: SavedCinema[], fetchedAt: Date, provider: Lookup['provider'], dataYear: number | null, source: 'live' | 'cache' | 'stale';
  if (row && cached && row.expiresAt > new Date()) {
    data = cached.data; provider = cached.provider; dataYear = cached.dataYear; fetchedAt = row.fetchedAt; source = cached.stale ? 'stale' : 'cache';
  } else {
    try {
      let work = pending.get(key);
      if (!work) {
        work = fetchAndCache(key, centerLat, centerLng, radiusM, !!(row && cached?.provider === 'openstreetmap' && cached.data.length && Date.now() - row.fetchedAt.getTime() <= MAX_STALE));
        pending.set(key, work);
        // Cleanup without creating an unhandled rejected promise.
        void work.then(() => pending.delete(key), () => pending.delete(key));
      }
      const fresh = await work;
      data = fresh.data; provider = fresh.provider; dataYear = fresh.dataYear; fetchedAt = fresh.fetchedAt; source = fresh.stale ? 'stale' : fresh.provider === 'sinca' ? 'cache' : 'live';
    } catch (error) {
      if (!row || !cached || Date.now() - row.fetchedAt.getTime() > MAX_STALE) throw error;
      data = cached.data; provider = cached.provider; dataYear = cached.dataYear; fetchedAt = row.fetchedAt; source = 'stale';
    }
  }
  const cinemas = data.map(c => ({ ...c, distanceKm: distanceKm(lat, lng, c.lat, c.lng) }))
    .filter(c => c.distanceKm <= radiusM / 1000).sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id)).slice(0, 20);
  return { cinemas, source, provider, dataYear, attribution: provider === 'sinca' ? `SInCA · Directorio de cines${dataYear ? ` (${dataYear})` : ''}` : '© OpenStreetMap contributors', updatedAt: fetchedAt.toISOString() };
}
