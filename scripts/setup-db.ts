import '../src/config';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { seedReferenceData } from '../prisma/reference';
import { prisma } from '../src/prisma';
import { backupDatabase } from './backup-db';
import { migrateImages } from './migrate-images';
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith('file:')) throw new Error('Configurá DATABASE_URL en backend/.env');
  const dbPath = url.slice(5);
  await mkdir(path.dirname(dbPath), { recursive: true });
  const file = await open(dbPath, 'a'); await file.close();
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set(tables.map(t => t.name));
  const cli = path.resolve(__dirname, '../node_modules/prisma/build/index.js');
  const run = (args: string[]) => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: path.resolve(__dirname, '..'), env: process.env });
  if (names.has('User')) {
    console.log('Backup previo:', await backupDatabase());
    if (!names.has('_prisma_migrations')) {
      for (const name of ['Movie', 'Genre', 'Review', 'Like', 'Repost', 'Friendship', 'Notification', 'Redemption']) {
        if (!names.has(name)) throw new Error('La base existente no coincide con el esquema inicial; no se modificó');
      }
      run(['migrate', 'resolve', '--applied', '202610260001_initial']);
    }
  }
  await prisma.$disconnect();
  run(['migrate', 'deploy']);
  // db:setup generates the client before launching this process. Regenerating it
  // after opening SQLite tries to replace the loaded engine DLL on Windows.
  await seedReferenceData();
  // Historical migrations dropped Upload rows while retaining review photo URLs.
  // Restore owned images before the upgraded API starts accepting review edits.
  await migrateImages({ backup: false });
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
