import '../config';
import { syncCatalog } from '../services/tmdb';
import { prisma } from '../prisma';
const started = Date.now();
syncCatalog(message => console.log(`[${Math.floor((Date.now() - started) / 1000)}s] ${message}`)).then(result => console.log('Sincronización TMDB:', result))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
