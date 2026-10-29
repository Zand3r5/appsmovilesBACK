import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { prisma } from '../prisma';
import { fail } from '../utils/http';
export const uploadDirectory = () => path.resolve(process.env.UPLOAD_DIR ?? path.resolve(__dirname, '../../uploads'));
const managedPath = /^\/media\/([0-9a-f-]{36}\.webp)$/;
export async function storeImage(ownerId: number, image: unknown) {
  if (typeof image !== 'string' || image.length > 2000000) fail(400, 'Imagen inválida o demasiado grande');
  const match = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) fail(400, 'Subí una imagen JPEG o PNG');
  let buffer: Buffer;
  try {
    const original = Buffer.from(match[1], 'base64');
    const reader = sharp(original, { limitInputPixels: 20000000 });
    const info = await reader.metadata();
    if (!['jpeg', 'png', 'webp'].includes(info.format ?? '')) fail(400, 'Formato de imagen inválido');
    buffer = await reader.rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch { fail(400, 'No se pudo leer la imagen'); }
  const id = randomUUID(), filename = `${id}.webp`;
  await mkdir(uploadDirectory(), { recursive: true });
  await writeFile(path.join(uploadDirectory(), filename), buffer, { flag: 'wx', mode: 0o644 });
  try { await prisma.upload.create({ data: { id, ownerId, filename, mime: 'image/webp', size: buffer.length } }); }
  catch (error) { await unlink(path.join(uploadDirectory(), filename)).catch(() => {}); throw error; }
  return `/media/${filename}`;
}
export async function imageReference(value: string | null | undefined, ownerId: number, allowExternal = false) {
  if (!value) return value;
  if (value.startsWith('data:')) return storeImage(ownerId, value);
  let pathname = value;
  try { pathname = new URL(value).pathname; } catch { /* relative asset */ }
  const match = managedPath.exec(pathname);
  if (match) {
    const file = await prisma.upload.findUnique({ where: { filename: match[1] } });
    if (!file || (!allowExternal && file.ownerId !== ownerId)) fail(403, 'La imagen no pertenece a tu cuenta');
    return pathname;
  }
  if (allowExternal && /^https?:\/\//.test(value)) return value;
  fail(400, 'Usá una imagen subida a WhatNext');
}
