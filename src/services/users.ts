import { prisma } from '../prisma';
import { publicUserSelect, sessionUser } from '../middlewares/auth';
import { cleanEmail, cleanText, ROLES } from '../utils/validation';
import { fail } from '../utils/http';
import { achievementStats, calculateRank, getAchievements } from './gamification';
import { findReviewRows, reviewDTO, reviewInclude } from './reviews';
import { getFriendIds } from './social';

export async function getUserReposts(userId: number, viewerId?: number) {
  const rows = await prisma.repost.findMany({
    where: { userId, review: { movie: { hidden: false } } },
    include: { review: { include: reviewInclude } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(row => reviewDTO(row.review, viewerId));
}

export async function getPublicProfile(userId: number, viewerId?: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) fail(404, 'Usuario no encontrado');
  const [reviewRows, reposts, friends] = await Promise.all([
    findReviewRows({ authorId: userId }),
    getUserReposts(userId, viewerId),
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
    rank,
    stats: {
      comments: comments.length,
      reposts: reposts.length,
      likesReceived: achievements.profile.likes,
      points: achievements.totalPoints,
      friends: friends.length,
    },
  };
}

export async function updateCurrentUser(userId: number, sessionId: string, body: any) {
  const name = cleanText(body?.name, 60);
  const email = cleanEmail(body?.email);
  if (!name || !email) fail(400, 'Nombre o email inválido');
  await prisma.$transaction(async tx => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    await tx.user.update({ where: { id: userId }, data: { name, email } });
    if (email !== current.email) await tx.session.deleteMany({ where: { userId, id: { not: sessionId } } });
  });
  return sessionUser(userId);
}

export function listUsers() {
  return prisma.user.findMany({ select: { ...publicUserSelect, email: true } });
}

export function updateUserRole(actorId: number, userId: number | null, role: unknown) {
  if (!userId || typeof role !== 'string' || !ROLES.includes(role)) fail(400, 'Rol inválido');
  if (userId === actorId && role !== 'superadmin') fail(400, 'No podés quitarte tu propio acceso de administración');
  return prisma.user.update({ where: { id: userId }, data: { role }, select: { ...publicUserSelect, email: true } });
}
