import './config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { syncCatalog } from './services/tmdb';
import { runPushDelivery } from './services/push';
import { prisma } from './prisma';
const expression = process.env.TMDB_CRON ?? '0 4 * * *';
if (!cron.validate(expression)) throw new Error('TMDB_CRON no válido');
if (!process.env.DATABASE_URL) throw new Error('El worker requiere DATABASE_URL');
const task = cron.schedule(expression, async () => {
  try { console.log('Sincronización TMDB:', await syncCatalog(message => console.log(`TMDB: ${message}`))); }
  catch (e) { console.error('Falló la sincronización diaria:', e); }
}, { timezone: 'America/Argentina/Buenos_Aires', noOverlap: true });
const pushTask = cron.schedule('* * * * *', async () => {
  try { await runPushDelivery(); } catch (e) { console.error('Falló la entrega push:', e instanceof Error ? e.message : 'Error'); }
}, { noOverlap: true });
void runPushDelivery().catch(() => console.error('No se pudo iniciar la entrega push'));
const heartbeatPath = process.env.WORKER_HEARTBEAT ?? path.join(path.dirname(process.env.DATABASE_URL!.slice(5)), 'worker-heartbeat');
const heartbeat = () => writeFile(heartbeatPath, new Date().toISOString()).catch(() => console.error('No se pudo actualizar heartbeat'));
void heartbeat();
const heartbeatTimer = setInterval(() => { void heartbeat(); }, 30000);
console.log(`Worker TMDB y notificaciones activo (${expression}, America/Argentina/Buenos_Aires)`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  clearInterval(heartbeatTimer);
  await task.stop();
  await pushTask.stop();
  await prisma.$disconnect();
  process.exit(0);
});
