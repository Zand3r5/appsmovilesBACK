import '../src/config';
import { mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/prisma';
import { uploadDirectory } from '../src/services/uploads';
export async function backupDatabase() {
  const location = process.env.DATABASE_URL?.slice(5);
  if (!location) throw new Error('Falta DATABASE_URL');
  const target = path.resolve(process.env.BACKUP_DIR ?? path.join(path.dirname(location), 'backups'), new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(target, { recursive: true, mode: 0o700 });
  // SQLite creates a consistent database snapshot even while the API is reading/writing.
  await prisma.$executeRawUnsafe('VACUUM INTO ?', path.join(target, 'whatnext.db'));
  await cp(uploadDirectory(), path.join(target, 'uploads'), { recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  return target;
}
if (require.main === module) backupDatabase().then(target => console.log('Backup:', target)).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
