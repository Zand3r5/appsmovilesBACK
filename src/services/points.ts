import { prisma } from '../prisma';
export async function pointsSummary(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const awards = await prisma.achievementAward.findMany({ where: { userId } });
  const redemptions = await prisma.redemption.findMany({ where: { userId, status: { notIn: ['canceled', 'refunded'] } } });
  return {
    balance: user.points,
    earned: awards.reduce((sum, row) => sum + row.points, 0),
    spent: redemptions.reduce((sum, row) => sum + row.cost, 0),
  };
}
