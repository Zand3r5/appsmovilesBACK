import { randomBytes } from 'node:crypto';
import type { Prisma, Redemption } from '@prisma/client';
import { prisma } from '../prisma';
import { fail } from '../utils/http';
import { calculateRank } from './ranks';
import { initializePoints, recordPoints, pointsSummary, withUserPoints } from './points';

export { calculateRank };

type AchievementStat = 'totalReviews' | 'maxLikesOnReview' | 'distinctGenres' | 'totalRatings' | 'totalPhotos';
type AchievementReview = {
  rating: number | null;
  photo: string | null;
  movie: { genres: { id: number }[] };
  _count?: { likes: number };
  likes?: unknown[];
};

export type AchievementStats = Record<AchievementStat, number> & { likesReceived: number };

export function achievementStats(reviews: AchievementReview[]): AchievementStats {
  const likeCount = (review: AchievementReview) => review._count?.likes ?? review.likes?.length ?? 0;
  return {
    totalReviews: reviews.length,
    maxLikesOnReview: Math.max(0, ...reviews.map(likeCount)),
    distinctGenres: new Set(reviews.flatMap(review => review.movie.genres.map(genre => genre.id))).size,
    totalRatings: reviews.filter(review => review.rating !== null).length,
    totalPhotos: reviews.filter(review => review.photo).length,
    likesReceived: reviews.reduce((total, review) => total + likeCount(review), 0),
  };
}

async function loadAchievementStats(db: Prisma.TransactionClient, userId: number) {
  const reviews = await db.review.findMany({
    where: { authorId: userId },
    include: { movie: { include: { genres: true } }, _count: { select: { likes: true } } },
  });
  return achievementStats(reviews);
}

async function buildAchievementsSnapshot(db: Prisma.TransactionClient, userId: number, suppliedStats?: AchievementStats) {
  const stats = suppliedStats ?? await loadAchievementStats(db, userId);
  const [definitions, awards, summary] = await Promise.all([
    db.achievement.findMany({ orderBy: { id: 'asc' } }),
    db.achievementAward.findMany({ where: { userId } }),
    pointsSummary(db, userId),
  ]);
  const awarded = new Map(awards.map(award => [award.achievementId, award]));
  return {
    list: definitions.map(definition => {
      const award = awarded.get(definition.id);
      const current = stats[definition.stat as AchievementStat] ?? 0;
      return {
        ...definition,
        points: award?.points ?? definition.points,
        current: award ? definition.goal : Math.min(current, definition.goal),
        unlocked: Boolean(award),
        awardedAt: award?.awardedAt ?? null,
      };
    }),
    totalPoints: summary.earned,
    availablePoints: summary.balance,
    profile: { reviews: stats.totalReviews, likes: stats.likesReceived },
  };
}

export function getAchievements(userId: number, stats?: AchievementStats) {
  return prisma.$transaction(tx => buildAchievementsSnapshot(tx, userId, stats));
}

export async function awardAchievements(tx: Prisma.TransactionClient, userId: number) {
  await initializePoints(tx, userId);
  const stats = await loadAchievementStats(tx, userId);
  const [definitions, existing] = await Promise.all([
    tx.achievement.findMany({ orderBy: { id: 'asc' } }),
    tx.achievementAward.findMany({ where: { userId }, select: { achievementId: true } }),
  ]);
  const awarded = new Set(existing.map(award => award.achievementId));
  for (const definition of definitions) {
    if (awarded.has(definition.id) || (stats[definition.stat as AchievementStat] ?? 0) < definition.goal) continue;
    const award = await tx.achievementAward.create({
      data: { userId, achievementId: definition.id, points: definition.points },
    });
    await recordPoints(tx, userId, `achievement:${definition.id}`, 'achievement', award.points, definition.title, award.awardedAt);
  }
}

export async function buildRewardsSnapshot(userId: number, db: Prisma.TransactionClient): Promise<{
  catalog: Prisma.RewardGetPayload<{}>[];
  spentPoints: number;
  availablePoints: number;
  redeemed: (Redemption & { title?: string; description?: string; icon?: string; date: Date })[];
}> {
  const [summary, catalog, rows] = await Promise.all([
    pointsSummary(db, userId),
    db.reward.findMany({ orderBy: { cost: 'asc' } }),
    db.redemption.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const rewards = new Map(catalog.map(reward => [reward.id, reward]));
  return {
    catalog,
    spentPoints: summary.spent,
    availablePoints: summary.balance,
    redeemed: rows.filter(row => row.status !== 'canceled').map(row => ({
      ...rewards.get(row.rewardId),
      ...row,
      status: row.status === 'active' && row.expiresAt <= new Date() ? 'expired' : row.status,
      date: row.createdAt,
    })),
  };
}

export function getRewards(userId: number) {
  return prisma.$transaction(tx => buildRewardsSnapshot(userId, tx));
}

export function getPoints(userId: number, before?: number) {
  return prisma.$transaction(async tx => {
    const entries = await tx.pointEntry.findMany({
      where: { userId, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: 51,
    });
    return {
      ...await pointsSummary(tx, userId),
      entries: entries.slice(0, 50),
      nextCursor: entries.length > 50 ? entries[49].id : null,
    };
  });
}

export function redeemReward(userId: number, rewardId: unknown) {
  return withUserPoints(userId, async tx => {
    const reward = typeof rewardId === 'string' ? await tx.reward.findUnique({ where: { id: rewardId } }) : null;
    if (!reward || !Number.isInteger(reward.cost) || reward.cost <= 0) fail(400, 'Premio no válido');
    await awardAchievements(tx, userId);
    const balance = await pointsSummary(tx, userId);
    if (balance.balance < reward.cost) fail(409, 'No te alcanzan los puntos');
    const redemption = await tx.redemption.create({
      data: {
        userId,
        rewardId: reward.id,
        cost: reward.cost,
        code: randomBytes(8).toString('hex').toUpperCase(),
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    await recordPoints(tx, userId, `redemption:${redemption.id}`, 'redemption', -reward.cost, `Canje: ${reward.title}`, redemption.createdAt);
    return {
      success: true,
      redemptionId: redemption.id,
      code: redemption.code,
      rewards: await buildRewardsSnapshot(userId, tx),
    };
  });
}
