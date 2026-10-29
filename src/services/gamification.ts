import type { Prisma, PrismaClient, Redemption } from '@prisma/client';
import { prisma } from '../prisma';
import { calculateRank } from './ranks';
import { initializePoints, recordPoints, pointsSummary, withUserPoints } from './points';
export { calculateRank };
type AchievementStat = 'totalReviews' | 'maxLikesOnReview' | 'distinctGenres' | 'totalRatings' | 'totalPhotos';

interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  stat: string;
  goal: number;
  points: number;
}

type AchievementsResult = {
  list: (AchievementDef & { current: number; unlocked: boolean; awardedAt: Date | null })[];
  totalPoints: number; availablePoints: number; profile: { reviews: number; likes: number };
};
export async function getAchievements(userId: number, db: Prisma.TransactionClient | PrismaClient = prisma): Promise<AchievementsResult> {
  if ('$transaction' in db) return withUserPoints(userId, tx => getAchievements(userId, tx));
  await initializePoints(db, userId);
  const reviews = await db.review.findMany({ where: { authorId: userId }, include: { movie: { include: { genres: true } }, _count: { select: { likes: true } } } });
  const stats: Record<AchievementStat, number> = {
    totalReviews: reviews.length,
    maxLikesOnReview: Math.max(0, ...reviews.map(r => r._count.likes)),
    distinctGenres: new Set(reviews.flatMap(r => r.movie.genres.map(g => g.id))).size,
    totalRatings: reviews.filter(r => r.rating !== null).length,
    totalPhotos: reviews.filter(r => r.photo).length,
  };
  const definitions = await db.achievement.findMany({ orderBy: { id: 'asc' } });
  for (const achievement of definitions) {
    if ((stats[achievement.stat as AchievementStat] ?? 0) < achievement.goal) continue;
    const award = await db.achievementAward.upsert({
      where: { userId_achievementId: { userId, achievementId: achievement.id } },
      create: { userId, achievementId: achievement.id, points: achievement.points }, update: {},
    });
    await recordPoints(db, userId, `achievement:${achievement.id}`, 'achievement', award.points, achievement.title, award.awardedAt);
  }
  const awards = await db.achievementAward.findMany({ where: { userId } });
  const list = definitions.map(a => {
    const award = awards.find(row => row.achievementId === a.id);
    return { ...a, points: award?.points ?? a.points, current: award ? a.goal : Math.min((stats[a.stat as AchievementStat] ?? 0), a.goal), unlocked: !!award, awardedAt: award?.awardedAt ?? null };
  });
  const summary = await pointsSummary(db, userId);
  return { list, totalPoints: summary.earned, availablePoints: summary.balance, profile: { reviews: reviews.length, likes: reviews.reduce((sum, r) => sum + r._count.likes, 0) } };
}

export async function getRewards(userId: number, db: Prisma.TransactionClient | PrismaClient = prisma): Promise<{
  catalog: Prisma.RewardGetPayload<{}>[]; spentPoints: number; availablePoints: number;
  redeemed: (Redemption & { title?: string; description?: string; icon?: string; date: Date })[];
}> {
  if ('$transaction' in db) return withUserPoints(userId, tx => getRewards(userId, tx));
  await getAchievements(userId, db);
  const summary = await pointsSummary(db, userId);
  const catalog = await db.reward.findMany({ orderBy: { cost: 'asc' } });
  const rows = await db.redemption.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return {
    catalog,
    spentPoints: summary.spent,
    availablePoints: summary.balance,
    redeemed: rows.filter(r => r.status !== 'canceled').map(r => ({ ...catalog.find(x => x.id === r.rewardId), ...r, status: r.status === 'active' && r.expiresAt <= new Date() ? 'expired' : r.status, date: r.createdAt })),
  };
}
