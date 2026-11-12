import { prisma } from '../prisma';
import { publicUserSelect } from './userShapes';
import { fail } from '../utils/http';
import { achievementStats, calculateRank, getAchievements } from './gamification';
import { findReviewRows, reviewDTO, reviewInclude } from './reviews';
import { getFriendIds } from './social';
import { validateRole, validateUserUpdate } from '../validation/users';

export async function getSessionUser(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: {
    id: true,
    name: true,
    email: true,
    role: true,
    likes: { select: { reviewId: true } },
    reposts: { select: { reviewId: true } },
  } });
  return { ...user, likes: user.likes.map(item => item.reviewId), reposts: user.reposts.map(item => item.reviewId) };
}

export async function getUserReposts(userId: number, viewerId?: number) {
  const rows = await prisma.repost.findMany({
    where: { userId, review: { movie: { hidden: false } } },
    include: { review: { include: reviewInclude } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(row => reviewDTO(row.review, viewerId));
}

async function getUserLikedReviews(userId: number, viewerId?: number) {
  const rows = await prisma.like.findMany({
    where: { userId, review: { movie: { hidden: false } } },
    include: { review: { include: reviewInclude } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(row => reviewDTO(row.review, viewerId));
}

export async function getPublicProfile(userId: number, viewerId?: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) fail(404, 'Usuario no encontrado');
  const [reviewRows, reposts, likedReviews, friends] = await Promise.all([
    findReviewRows({ authorId: userId }),
    getUserReposts(userId, viewerId),
    getUserLikedReviews(userId, viewerId),
    getFriendIds(userId),
  ]);
  const comments = reviewRows.map(review => reviewDTO(review, viewerId));
  const [achievements, rank] = await Promise.all([
    getAchievements(userId, achievementStats(reviewRows)),
    calculateRank(comments.length),
  ]);
  return {
    user,
    comments,
    reposts,
    likedReviews,
    rank,
    stats: {
      comments: comments.length,
      reposts: reposts.length,
      likesGiven: likedReviews.length,
      likesReceived: achievements.profile.likes,
      points: achievements.totalPoints,
      friends: friends.length,
    },
  };
}

export async function updateCurrentUser(userId: number, sessionId: string, body: unknown) {
  const { name, email } = validateUserUpdate(body);
  await prisma.$transaction(async tx => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    await tx.user.update({ where: { id: userId }, data: { name, email } });
    if (email !== current.email) await tx.session.deleteMany({ where: { userId, id: { not: sessionId } } });
  });
  return getSessionUser(userId);
}

export function listUsers() {
  return prisma.user.findMany({ select: { ...publicUserSelect, email: true } });
}

export function updateUserRole(actorId: number, userId: number, role: unknown) {
  const nextRole = validateRole(role);
  if (userId === actorId && nextRole !== 'superadmin') fail(400, 'No podés quitarte tu propio acceso de administración');
  return prisma.user.update({ where: { id: userId }, data: { role: nextRole }, select: { ...publicUserSelect, email: true } });
}
