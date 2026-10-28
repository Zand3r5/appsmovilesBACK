import { prisma } from '../prisma';
import { fail } from '../utils/http';
export async function walletAvailability() {
  const reason = 'Wallet no está disponible en esta entrega. Usá el código del canje.';
  return { apple: { available: false, reason }, google: { available: false, reason } };
}
export async function createWalletLink(userId: number, id: number, _provider: string) {
  const row = await prisma.redemption.findFirst({ where: { id, userId } });
  if (!row) fail(404, 'Canje no encontrado');
  if (row.status !== 'active' || row.usedAt || row.refundedAt || row.expiresAt <= new Date()) fail(409, 'Solo podés agregar a Wallet un canje disponible y vigente');
  fail(503, 'Wallet no está disponible. Usá el código del canje.');
}
