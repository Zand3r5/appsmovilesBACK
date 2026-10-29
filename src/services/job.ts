import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';
export async function withJobLease<T>(name: string, job: () => Promise<T>) {
  const owner = randomUUID();
  const acquired = await prisma.$transaction(async tx => {
    await tx.jobLock.deleteMany({ where: { name, expiresAt: { lt: new Date() } } });
    try { await tx.jobLock.create({ data: { name, owner, expiresAt: new Date(Date.now() + 120000) } }); return true; }
    catch (e: any) { if (e.code === 'P2002') return false; throw e; }
  });
  if (!acquired) return { skipped: true };
  const timer = setInterval(() => { void prisma.jobLock.updateMany({ where: { name, owner }, data: { expiresAt: new Date(Date.now() + 120000) } }).catch(() => {}); }, 30000);
  try { return await job(); }
  finally { clearInterval(timer); await prisma.jobLock.deleteMany({ where: { name, owner } }); }
}
