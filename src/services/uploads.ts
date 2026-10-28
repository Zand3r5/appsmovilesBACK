// Guardamos el archivo con un nombre propio para evitar sobrescribir imágenes existentes.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../utils/http';
export const uploadDirectory = () => path.resolve(process.env.UPLOAD_DIR ?? path.resolve(__dirname, '../../uploads'));
const managedPath = /^\/media\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/;
export async function storeImage(_ownerId: number, image: unknown) {
  if (typeof image !== 'string' || image.length > 2000000) fail(400, 'Imagen inválida o demasiado grande');
  // La app siempre manda "data:image/jpeg", aunque la foto sea PNG o WebP: el tipo real se saca de los primeros bytes.
  const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
  if (!match) fail(400, 'Subí una imagen JPEG, PNG o WebP');
  const buffer = Buffer.from(match[1], 'base64');
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const webp = buffer.length > 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (!png && !jpeg && !webp) fail(400, 'No se pudo leer la imagen');
  const filename = randomUUID() + (png ? '.png' : webp ? '.webp' : '.jpg');
  await mkdir(uploadDirectory(), { recursive: true });
  await writeFile(path.join(uploadDirectory(), filename), buffer, { flag: 'wx' });
  return '/media/' + filename;
}
export async function imageReference(value: string | null | undefined, ownerId: number, allowExternal = false) {
  if (!value) return value;
  if (value.startsWith('data:')) return storeImage(ownerId, value);
  let pathname = value;
  try { pathname = new URL(value).pathname; } catch {}
  const match = managedPath.exec(pathname);
  if (match) {
    try { await access(path.join(uploadDirectory(), match[1])); } catch { fail(400, 'La imagen no existe'); }
    return pathname;
  }
  if (allowExternal && /^https?:\/\//.test(value)) return value;
  fail(400, 'Usá una imagen subida a WhatNext');
}
