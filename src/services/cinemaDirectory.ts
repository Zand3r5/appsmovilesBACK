import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { prisma } from '../prisma';
import type { SavedCinema } from './cinemas';

export const CINEMA_DIRECTORY_URL = 'https://datos.cultura.gob.ar/dataset/37305de4-3cce-4d4b-9d9a-fec3ca61d09f/resource/f7a8edb8-9208-41b0-8f19-d72811dcea97/download/salas_cine.csv';
const key = 'directory:sinca:argentina:v1';
const TTL = 24 * 3600000, MAX_STALE = 30 * 86400000;
const snapshotSchema = z.object({
  dataYear: z.number().int().min(2000).max(2100).nullable(),
  data: z.array(z.object({ id: z.string(), name: z.string(), address: z.string().nullable(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).min(1),
});
type Directory = z.infer<typeof snapshotSchema> & { fetchedAt: Date; stale: boolean };
let pending: Promise<Directory> | undefined;

export function parseCinemaDirectory(csv: string): { data: SavedCinema[]; dataYear: number | null } {
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true, trim: true, max_record_size: 20000 }) as Record<string, string>[];
  if (!rows.length || !['nombre', 'direccion', 'latitud', 'longitud'].every(field => field in rows[0])) throw new Error('Invalid cinema directory columns');
  const data: SavedCinema[] = [], years: number[] = [];
  for (const row of rows) {
    const lat = Number(row.latitud?.replace(',', '.')), lng = Number(row.longitud?.replace(',', '.'));
    if (!row.nombre?.trim() || !row.latitud?.trim() || !row.longitud?.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -56 || lat > -21 || lng < -74 || lng > -53) continue;
    const name = row.nombre.trim(), address = [row.direccion, row.localidad, row.provincia].filter(Boolean).join(', ') || null;
    const id = 'sinca/' + createHash('sha256').update(`${name}:${lat}:${lng}`).digest('hex').slice(0, 24);
    data.push({ id, name, address, lat, lng });
    const year = Number(row['año_actualizacion']);
    if (Number.isInteger(year) && year >= 2000 && year <= new Date().getFullYear()) years.push(year);
  }
  if (!data.length) throw new Error('Cinema directory contains no usable coordinates');
  return { data: [...new Map(data.map(row => [row.id, row])).values()], dataYear: years.length ? Math.min(...years) : null };
}

export const inArgentinaRegion = (lat: number, lng: number) => lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53;
async function loadDirectory(): Promise<Directory> {
  const row = await prisma.cinemaLookup.findUnique({ where: { key } });
  let saved: z.infer<typeof snapshotSchema> | undefined;
  try { if (row) saved = snapshotSchema.parse(JSON.parse(row.data)); } catch { }
  if (row && saved && row.expiresAt > new Date()) return { ...saved, fetchedAt: row.fetchedAt, stale: false };
  try {
    if (process.env.NODE_ENV === 'test' && !process.env.CINEMA_DIRECTORY_URL) throw new Error('No test directory');
    const response = await fetch(process.env.CINEMA_DIRECTORY_URL || CINEMA_DIRECTORY_URL, { signal: AbortSignal.timeout(4500), headers: { Accept: 'text/csv', 'User-Agent': 'WhatNext/1.0' } });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 2000000) throw new Error('Cinema directory unavailable');
    const csv = await response.text();
    if (csv.length > 2000000) throw new Error('Cinema directory too large');
    const snapshot = parseCinemaDirectory(csv), fetchedAt = new Date();
    await prisma.cinemaLookup.upsert({ where: { key }, create: { key, data: JSON.stringify(snapshot), fetchedAt, expiresAt: new Date(Date.now() + TTL) },
      update: { data: JSON.stringify(snapshot), fetchedAt, expiresAt: new Date(Date.now() + TTL) } });
    return { ...snapshot, fetchedAt, stale: false };
  } catch (error) {
    if (row && saved && Date.now() - row.fetchedAt.getTime() <= MAX_STALE) return { ...saved, fetchedAt: row.fetchedAt, stale: true };
    throw error;
  }
}
export async function getCinemaDirectory() {
  if (!pending) {
    pending = loadDirectory();
    void pending.then(() => { pending = undefined; }, () => { pending = undefined; });
  }
  return pending;
}
