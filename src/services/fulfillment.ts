import { prisma } from '../prisma';
import { fail } from '../utils/http';
import { getRewards } from './gamification';
export function redemptionStatus(row: { status: string; expiresAt: Date }) {
  return row.status === 'active' && row.expiresAt <= new Date() ? 'expired' : row.status;
}
export async function validateRedemption(code: unknown) {
  if (typeof code !== 'string' || !/^[A-F0-9]{16}$/.test(code.trim().toUpperCase())) fail(400, 'Ingresá un código de canje válido');
  const row = await prisma.redemption.findUnique({ where: { code: code.trim().toUpperCase() }, include: { user: { select: { id: true, name: true } }, reward: true } });
  if (!row) fail(404, 'Código no encontrado');
  return { ...row, status: redemptionStatus(row) };
}
export async function useRedemption(code: unknown, actorId: number) {
  const row = await validateRedemption(code);
  const changed = await prisma.redemption.updateMany({ where: { id: row.id, status: 'active', usedAt: null, refundedAt: null, expiresAt: { gt: new Date() } }, data: { status: 'used', usedAt: new Date(), usedById: actorId } });
  if (!changed.count) fail(409, 'El código ya fue usado, venció o fue reintegrado');
  return validateRedemption(row.code);
}
async function reverseRedemption(id: number, actorId: number, ownerOnly: boolean) {
  const row = await prisma.redemption.findFirst({ where: { id, ...(ownerOnly ? { userId: actorId } : {}) } });
  if (!row) fail(404, 'Canje no encontrado');
  if (row.cost <= 0) fail(409, 'Importe de canje inválido');
  const changed = await prisma.$transaction(async tx => {
    const result = await tx.redemption.updateMany({ where: { id, status: 'active', usedAt: null, refundedAt: null }, data: { status: ownerOnly ? 'canceled' : 'refunded', refundedAt: new Date(), refundedById: actorId } });
    if (!result.count) return false;
    // Estado, saldo e historial se guardan juntos para no reintegrar dos veces.
    await tx.user.update({ where: { id: row.userId }, data: { points: { increment: row.cost } } });
    await tx.pointEntry.create({ data: { userId: row.userId, kind: 'refund', amount: row.cost, description: 'Reintegro: ' + row.rewardId } });
    return true;
  });
  if (!changed) {
    const current = await prisma.redemption.findUniqueOrThrow({ where: { id } });
    if (!ownerOnly || current.status !== 'canceled') fail(409, 'Solo se pueden anular canjes que no fueron usados ni reintegrados');
  }
  return ownerOnly ? { canceled: true, alreadyCanceled: !changed, rewards: await getRewards(row.userId) } : { refunded: true };
}
export async function refundRedemption(id: number, actorId: number) { return reverseRedemption(id, actorId, false); }
export async function cancelRedemption(id: number, userId: number) { return reverseRedemption(id, userId, true); }
