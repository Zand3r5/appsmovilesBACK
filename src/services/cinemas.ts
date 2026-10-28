// La distancia se calcula en el servidor; solo devolvemos cines dentro del radio pedido.
import { fail } from '../utils/http';
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (n: number) => n * Math.PI / 180;
  const a = Math.sin(radians(lat2-lat1)/2)**2 + Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(radians(lng2-lng1)/2)**2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export async function getNearbyCinemas(body: any) {
  const lat = body?.lat, lng = body?.lng, radiusM = body?.radiusM ?? 15000;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90 || typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isInteger(radiusM) || radiusM < 1000 || radiusM > 50000) fail(400, 'Ubicación o radio inválido. El radio debe estar entre 1 y 50 km');
  let elements: any[];
  try {
    const response = await fetch(process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'WhatNext/1.0' },
      body: 'data=' + encodeURIComponent(`[out:json][timeout:6];nwr["amenity"="cinema"](around:${radiusM},${lat},${lng});out center tags;`),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Overpass no respondió');
    const data: any = await response.json();
    if (!Array.isArray(data.elements) || data.remark) throw new Error('Respuesta incompleta');
    elements = data.elements;
  } catch { fail(503, 'No pudimos consultar los cines. Intentá de nuevo en unos minutos'); }
  const cinemas: Array<{ id: string; name: string; address: string | null; lat: number; lng: number; distanceKm: number }> = [];
  for (const element of elements) {
    if (!element || !['node','way','relation'].includes(element.type) || !Number.isInteger(element.id)) continue;
    const latitude = element.lat ?? element.center?.lat, longitude = element.lon ?? element.center?.lon;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) continue;
    const id = element.type + '/' + element.id;
    const distance = distanceKm(lat,lng,latitude,longitude);
    if (distance > radiusM/1000 || cinemas.some(row => row.id === id)) continue;
    const tags = element.tags ?? {};
    const address = [tags['addr:street'],tags['addr:housenumber']].filter(value => typeof value === 'string').join(' ');
    cinemas.push({ id, name: typeof tags.name === 'string' ? tags.name : 'Cine sin nombre', address: address || null, lat: latitude, lng: longitude, distanceKm: distance });
  }
  cinemas.sort((a,b) => a.distanceKm-b.distanceKm || a.id.localeCompare(b.id));
  return { cinemas: cinemas.slice(0,20), source: 'live', updatedAt: new Date().toISOString() };
}
