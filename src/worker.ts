import './config';
import cron from 'node-cron';
import { syncCatalog } from './services/tmdb';
import { prisma } from './prisma';
const CATALOG_SCHEDULE = '0 4 * * *';
if (!process.env.DATABASE_URL) throw new Error('El worker requiere DATABASE_URL');
const task = cron.schedule(CATALOG_SCHEDULE, async () => {
  try { console.log('Sincronización TMDB:', await syncCatalog(message => console.log(`TMDB: ${message}`))); }
  catch (e) { console.error('Falló la sincronización diaria:', e); }
}, { timezone: 'America/Argentina/Buenos_Aires', noOverlap: true });
console.log(`Worker TMDB activo (${CATALOG_SCHEDULE}, America/Argentina/Buenos_Aires)`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await task.stop();
  await prisma.$disconnect();
  process.exit(0);
});
