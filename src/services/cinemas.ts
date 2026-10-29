import { z } from 'zod';
import { prisma } from '../prisma';
import { fail } from '../utils/http';
export const cinemaQuery = z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(1000).max(50000).default(15000),
}).strict();
const cinema = z.object({ id: z.string(), name: z.string(), address: z.string().nullable(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
type SavedCinema = z.infer<typeof cinema>;
const TTL = 6 * 3600000, MAX_STALE = 24 * 3600000;
const pending = new Map<string, Promise<{ data: SavedCinema[]; fetchedAt: Date }>>();
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (n: number) => n * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
async function queryOverpass(lat: number, lng: number, radiusM: number): Promise<SavedCinema[]> {
  const query = `[out:json][timeout:25];nwr["amenity"="cinema"](around:${radiusM},${lat},${lng});out center tags;`;
  const endpoints = process.env.OVERPASS_URL
    ? [process.env.OVERPASS_URL]
    : ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  async function ask(url: string): Promise<SavedCinema[]> {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'WhatNext/1.0' },
      body: `data=${encodeURIComponent(query)}`, signal: controller.signal,
    });
    if (!response.ok) throw new Error('Overpass no respondió');
    const body = await response.json() as { elements?: unknown[]; remark?: string };
    // Overpass can return HTTP 200 with a runtime/timeout error and incomplete results.
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
    return [...new Map(rows.map(c => [c.id, c])).values()];
  }
  async function askNominatim(): Promise<SavedCinema[]> {
    const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
    const url = new URL(process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      format: 'jsonv2', amenity: 'cinema', limit: '40', bounded: '1', addressdetails: '1',
      viewbox: [lng - dLng, lat + dLat, lng + dLng, lat - dLat].join(','),
    }).toString();
    const response = await fetch(url, { headers: { 'User-Agent': 'WhatNext/1.0', 'Accept-Language': 'es' }, signal: controller.signal });
    if (!response.ok) throw new Error('Nominatim no respondió');
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('Respuesta de cines incompleta');
    const rows: SavedCinema[] = [];
    for (const el of body as any[]) {
      if (!['node', 'way', 'relation'].includes(el?.osm_type) || !Number.isInteger(el.osm_id)) continue;
      const address = [el.address?.road, el.address?.house_number].filter(x => typeof x === 'string').join(' ');
      const parsed = cinema.safeParse({ id: `${el.osm_type}/${el.osm_id}`, name: el.name || 'Cine sin nombre', address: address || null, lat: Number(el.lat), lng: Number(el.lon) });
      if (parsed.success) rows.push(parsed.data);
    }
    return [...new Map(rows.map(c => [c.id, c])).values()];
  }
  try {
    const useNominatim = !process.env.OVERPASS_URL || !!process.env.NOMINATIM_URL;
    return await Promise.any([...endpoints.map(ask), ...(useNominatim ? [askNominatim()] : [])]);
  } catch {
    fail(503, 'No pudimos consultar los cines. Intentá de nuevo en unos minutos');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
async function fetchAndCache(key: string, lat: number, lng: number, radiusM: number) {
  const data = await queryOverpass(lat, lng, radiusM + 1000);
  const fetchedAt = new Date(), expiresAt = new Date(Date.now() + TTL);
  await prisma.cinemaLookup.upsert({ where: { key }, create: { key, data: JSON.stringify(data), fetchedAt, expiresAt }, update: { data: JSON.stringify(data), fetchedAt, expiresAt } });
  await prisma.cinemaLookup.deleteMany({ where: { fetchedAt: { lt: new Date(Date.now() - MAX_STALE) } } });
  // Bound the cache even if many distinct areas are queried within a day.
  const excess = await prisma.cinemaLookup.findMany({ orderBy: [{ fetchedAt: 'desc' }, { key: 'asc' }], skip: 1000, select: { key: true } });
  if (excess.length) await prisma.cinemaLookup.deleteMany({ where: { key: { in: excess.map(c => c.key) } } });
  return { data, fetchedAt };
}
export async function getNearbyCinemas(body: unknown) {
  const parsed = cinemaQuery.safeParse(body);
  if (!parsed.success) fail(400, 'Ubicación o radio inválido. El radio debe estar entre 1 y 50 km');
  const { lat, lng, radiusM } = parsed.data;
  // Reuse an area cache without storing an account's precise GPS coordinates.
  const centerLat = Number(lat.toFixed(2)), centerLng = Number(lng.toFixed(2));
  const key = `${centerLat.toFixed(2)}:${centerLng.toFixed(2)}:${radiusM}`;
  const row = await prisma.cinemaLookup.findUnique({ where: { key } });
  let cached: SavedCinema[] | null = null;
  try { if (row) cached = z.array(cinema).parse(JSON.parse(row.data)); } catch { /* replace corrupt cached data */ }
  let data: SavedCinema[], fetchedAt: Date, source: 'live' | 'cache' | 'stale';
  if (row && cached && row.expiresAt > new Date()) {
    data = cached; fetchedAt = row.fetchedAt; source = 'cache';
  } else {
    try {
      let work = pending.get(key);
      if (!work) {
        work = fetchAndCache(key, centerLat, centerLng, radiusM);
        pending.set(key, work);
        // Cleanup without creating an unhandled rejected promise.
        void work.then(() => pending.delete(key), () => pending.delete(key));
      }
      const fresh = await work;
      data = fresh.data; fetchedAt = fresh.fetchedAt; source = 'live';
    } catch (error) {
      if (!row || !cached || Date.now() - row.fetchedAt.getTime() > MAX_STALE) throw error;
      data = cached; fetchedAt = row.fetchedAt; source = 'stale';
    }
  }
  const cinemas = data.map(c => ({ ...c, distanceKm: distanceKm(lat, lng, c.lat, c.lng) }))
    .filter(c => c.distanceKm <= radiusM / 1000).sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id)).slice(0, 20);
  return { cinemas, source, updatedAt: fetchedAt.toISOString() };
}
