import '../src/config';
import { prisma } from '../src/prisma';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { storeImage, uploadDirectory } from '../src/services/uploads';
import { backupDatabase } from './backup-db';
async function main() {
  console.log('Backup previo:', await backupDatabase());
  let converted = 0;
  // Only migrate files referenced by existing database rows. Never claim an
  // arbitrary public URL for a caller, and retain old files for existing links.
  async function migrateReference(ownerId: number, value: string | null) {
    if (!value) return null;
    if (value.startsWith('data:image/')) return storeImage(ownerId, value);
    let pathname = value;
    try { pathname = new URL(value).pathname; } catch {}
    const match = /^\/media\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(pathname);
    if (!match) return null;
    const owned = await prisma.upload.findUnique({ where: { filename: match[1] } });
    if (owned?.ownerId === ownerId) return null;
    const buffer = await readFile(path.join(uploadDirectory(), match[1]));
    const image = 'data:image/' + (match[1].endsWith('.webp') ? 'webp' : match[1].endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + buffer.toString('base64');
    return storeImage(ownerId, image);
  }
  for (const row of await prisma.review.findMany({ where: { photo: { not: null } } })) {
    const photo = await migrateReference(row.authorId, row.photo);
    if (photo) { await prisma.review.updateMany({ where: { id: row.id, photo: row.photo }, data: { photo } }); converted++; }
  }
  for (const row of await prisma.movie.findMany()) {
    for (const field of ['posterPath', 'backdropPath'] as const) {
      const url = await migrateReference(0, row[field]);
      if (url) { await prisma.movie.updateMany({ where: { id: row.id, [field]: row[field] }, data: { [field]: url } }); converted++; }
    }
  }
  console.log('Imágenes migradas:', converted);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
