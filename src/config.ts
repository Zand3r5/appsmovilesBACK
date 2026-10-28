import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
if (process.env.DATABASE_URL?.startsWith('file:')) {
  const location = process.env.DATABASE_URL.slice(5);
  process.env.DATABASE_URL = `file:${path.resolve(__dirname, '../prisma', location)}`;
}
export function validateConfig() {
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('replace-with'))) throw new Error('Configurá un JWT_SECRET de producción seguro');
  for (const name of ['DATABASE_URL', 'JWT_SECRET']) {
    if (!process.env[name]) throw new Error(`Falta ${name} en backend/.env`);
  }
}
