import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export async function withUserPoints<T>(userId: number, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    // Serialize awards, spending and refunds before reading the balance.
    await tx.user.update({ where: { id: userId }, data: { id: userId } });
    return work(tx);
  });
}
export async function recordPoints(tx: Prisma.TransactionClient, userId: number, key: string, kind: string, amount: number, description: string, createdAt?: Date) {
  return tx.pointEntry.upsert({ where: { userId_key: { userId, key } },
    create: { userId, key, kind, amount, description, ...(createdAt ? { createdAt } : {}) }, update: {} });
}
export async function initializePoints(tx: Prisma.TransactionClient, userId: number) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsInitializedAt: true } });
  if (user.pointsInitializedAt) return;
  const rows = await tx.redemption.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  for (const row of rows) {
    await recordPoints(tx, userId, `redemption:${row.id}`, 'redemption', -row.cost, `Canje: ${row.rewardId}`, row.createdAt);
    if (row.refundedAt) await recordPoints(tx, userId, `refund:${row.id}`, 'refund', row.cost, `Reintegro: ${row.rewardId}`, row.refundedAt);
  }
  await tx.user.update({ where: { id: userId }, data: { pointsInitializedAt: new Date() } });
}
export async function pointsSummary(tx: Prisma.TransactionClient, userId: number) {
  const groups = await tx.pointEntry.groupBy({ by: ['kind'], where: { userId }, _sum: { amount: true } });
  const amount = (kind: string) => groups.find(row => row.kind === kind)?._sum.amount ?? 0;
  return { balance: groups.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0), earned: amount('achievement'), spent: -amount('redemption') - amount('refund') };
}
