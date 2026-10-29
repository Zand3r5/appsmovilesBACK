import { prisma } from '../prisma';
import { fail } from '../utils/http';
import { getAchievements, getRewards } from './gamification';
import { recordPoints, withUserPoints } from './points';
export function redemptionStatus(row: { status: string; expiresAt: Date }) {
  return row.status === 'active' && row.expiresAt <= new Date() ? 'expired' : row.status;
}
export async function validateRedemption(code: unknown) {
  if (typeof code !== 'string' || !/^[A-F0-9]{16}$/.test(code.trim().toUpperCase())) fail(400, 'Ingresá un código de canje válido');
  const row = await prisma.redemption.findUnique({ where: { code: code.trim().toUpperCase() }, include: { user: { select: { id: true, name: true } }, reward: true } });
  if (!row) fail(404, 'Código no encontrado');
  return { ...row, status: redemptionStatus(row), reward: row.reward };
}
export async function useRedemption(code: unknown, actorId: number) {
  const row = await validateRedemption(code);
  const changed = await prisma.redemption.updateMany({ where: { id: row.id, status: 'active', usedAt: null, refundedAt: null, expiresAt: { gt: new Date() } }, data: { status: 'used', usedAt: new Date(), usedById: actorId } });
  if (!changed.count) fail(409, 'El código ya fue usado, venció o fue reintegrado');
  return validateRedemption(row.code);
}
async function reverseRedemption(id: number, actorId: number, ownerOnly: boolean) {
  const owner = await prisma.redemption.findFirst({ where: { id, ...(ownerOnly ? { userId: actorId } : {}) }, select: { userId: true } });
  if (!owner) fail(404, 'Canje no encontrado');
  return withUserPoints(owner.userId, async tx => {
    // Legacy accounts are initialized inside the same writer transaction.
    await getAchievements(owner.userId, tx);
    const row = await tx.redemption.findUniqueOrThrow({ where: { id } });
    const debit = await tx.pointEntry.findUnique({ where: { userId_key: { userId: row.userId, key: `redemption:${id}` } } });
    const credit = await tx.pointEntry.findUnique({ where: { userId_key: { userId: row.userId, key: `refund:${id}` } } });
    if (!debit || debit.kind !== 'redemption' || debit.amount !== -row.cost || row.cost <= 0) fail(409, 'No se pudo verificar el débito original. Contactá al administrador.');
    if (ownerOnly && row.status === 'canceled' && !row.usedAt && row.refundedAt && credit?.kind === 'refund' && credit.amount === row.cost) {
      // Safe retries after a lost response return the existing reversal, never another credit.
      return { canceled: true, alreadyCanceled: true, rewards: await getRewards(row.userId, tx) };
    }
    if (credit) fail(409, 'Este canje ya tiene un reintegro registrado');
    const changed = await tx.redemption.updateMany({
      where: { id, userId: owner.userId, status: 'active', usedAt: null, refundedAt: null },
      data: { status: ownerOnly ? 'canceled' : 'refunded', refundedAt: new Date(), refundedById: actorId },
    });
    if (!changed.count) fail(409, 'Solo se pueden anular canjes que no fueron usados ni reintegrados');
    // The code is invalidated before the matching credit is inserted; either both commit or neither.
    const reward = await tx.reward.findUnique({ where: { id: row.rewardId } });
    await recordPoints(tx, row.userId, `refund:${id}`, 'refund', row.cost, `${ownerOnly ? 'Anulación' : 'Reintegro'}: ${reward?.title ?? row.rewardId}`);
    return ownerOnly ? { canceled: true, alreadyCanceled: false, rewards: await getRewards(row.userId, tx) } : { refunded: true };
  });
}
export async function refundRedemption(id: number, actorId: number) {
  return reverseRedemption(id, actorId, false);
}
export async function cancelRedemption(id: number, userId: number) {
  return reverseRedemption(id, userId, true);
}
