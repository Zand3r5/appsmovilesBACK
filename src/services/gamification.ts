import { prisma } from '../prisma';
import { pointsSummary } from './points';
export { calculateRank } from './ranks';

async function achievementStats(userId: number) {
  const reviews = await prisma.review.findMany({ where: { authorId: userId }, include: { movie: { include: { genres: true } }, _count: { select: { likes: true } } } });
  return {
    totalReviews: reviews.length,
    maxLikesOnReview: Math.max(0, ...reviews.map(row => row._count.likes)),
    distinctGenres: new Set(reviews.flatMap(row => row.movie.genres.map(genre => genre.id))).size,
    totalRatings: reviews.filter(row => row.rating !== null).length,
    totalPhotos: reviews.filter(row => row.photo).length,
    likes: reviews.reduce((sum, row) => sum + row._count.likes, 0),
  };
}
// Los logros se otorgan al guardar actividad, nunca al consultar una pantalla.
export async function awardAchievements(userId: number) {
  const stats: Record<string, number> = await achievementStats(userId);
  const definitions = await prisma.achievement.findMany({ orderBy: { id: 'asc' } });
  for (const achievement of definitions) {
    if ((stats[achievement.stat] ?? 0) < achievement.goal) continue;
    const where = { userId_achievementId: { userId, achievementId: achievement.id } };
    if (await prisma.achievementAward.findUnique({ where })) continue;
    try {
      await prisma.$transaction([
        prisma.achievementAward.create({ data: { userId, achievementId: achievement.id, points: achievement.points } }),
        prisma.user.update({ where: { id: userId }, data: { points: { increment: achievement.points } } }),
        prisma.pointEntry.create({ data: { userId, kind: 'achievement', amount: achievement.points, description: achievement.title } }),
      ]);
    } catch (error: any) { if (error.code !== 'P2002') throw error; }
  }
}
export async function getAchievements(userId: number) {
  const stats: Record<string, number> = await achievementStats(userId);
  const definitions = await prisma.achievement.findMany({ orderBy: { id: 'asc' } });
  const awards = await prisma.achievementAward.findMany({ where: { userId } });
  const summary = await pointsSummary(userId);
  return {
    list: definitions.map(definition => {
      const award = awards.find(row => row.achievementId === definition.id);
      return { ...definition, points: award?.points ?? definition.points, current: award ? definition.goal : Math.min(stats[definition.stat] ?? 0, definition.goal), unlocked: !!award, awardedAt: award?.awardedAt ?? null };
    }),
    totalPoints: summary.earned, availablePoints: summary.balance,
    profile: { reviews: stats.totalReviews, likes: stats.likes },
  };
}
export async function getRewards(userId: number) {
  const catalog = await prisma.reward.findMany({ orderBy: { cost: 'asc' } });
  const rows = await prisma.redemption.findMany({ where: { userId, status: { not: 'canceled' } }, orderBy: { createdAt: 'desc' } });
  const summary = await pointsSummary(userId);
  return {
    catalog, spentPoints: summary.spent, availablePoints: summary.balance,
    redeemed: rows.map(row => ({ ...catalog.find(reward => reward.id === row.rewardId), ...row, status: row.status === 'active' && row.expiresAt <= new Date() ? 'expired' : row.status, date: row.createdAt })),
  };
}
