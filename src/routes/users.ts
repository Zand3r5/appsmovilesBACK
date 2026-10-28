import type { Express } from 'express';
import { prisma } from '../prisma';
import { optionalAuth, publicUserSelect, requireAuth, requireRole, sessionUser } from '../middlewares/auth';
import { cleanEmail, cleanText, parseId, ROLES } from '../utils/validation';
import { fail } from '../utils/http';
import { getAchievements, calculateRank } from '../services/gamification';
import { listReviews, reviewDTO, reviewInclude } from '../services/reviews';
import { getFriendIds } from '../services/social';

async function userReposts(userId: number, viewer?: number) {
  const rows = await prisma.repost.findMany({ where: { userId, review: { movie: { hidden: false } } }, include: { review: { include: reviewInclude } }, orderBy: { createdAt: 'desc' } });
  return rows.map(r => reviewDTO(r.review, viewer));
}
export function userRoutes(app: Express) {
  app.patch('/api/users/me', requireAuth, async (req, res) => {
    const name = cleanText(req.body?.name, 60), email = cleanEmail(req.body?.email);
    if (!name || !email) fail(400, 'Nombre o email inválido');
    await prisma.user.update({ where: { id: req.userId }, data: { name: name!, email: email! } });
    res.json(await sessionUser(req.userId!));
  });
  app.get('/api/users', requireAuth, requireRole('superadmin'), async (_req, res) => res.json(await prisma.user.findMany({ select: { ...publicUserSelect, email: true } })));
  app.patch('/api/users/:id/role', requireAuth, requireRole('superadmin'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id || !ROLES.includes(req.body?.role)) fail(400, 'Rol inválido');
    if (id === req.userId && req.body.role !== 'superadmin') fail(400, 'No podés quitarte tu propio acceso de administración');
    res.json(await prisma.user.update({ where: { id: id! }, data: { role: req.body.role }, select: { ...publicUserSelect, email: true } }));
  });
  app.get('/api/users/:id', optionalAuth, async (req, res) => {
    const id = parseId(req.params.id) ?? 0;
    const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    if (!user) fail(404, 'Usuario no encontrado');
    const [comments, reposts, achievements, friends] = await Promise.all([listReviews({ authorId: id }, req.userId), userReposts(id, req.userId), getAchievements(id), getFriendIds(id)]);
    res.json({ user, comments, reposts, rank: await calculateRank(comments.length), stats: { comments: comments.length, reposts: reposts.length, likesReceived: achievements.profile.likes, points: achievements.totalPoints, friends: friends.length } });
  });
  app.get('/api/users/:id/reviews', optionalAuth, async (req, res) => res.json(await listReviews({ authorId: parseId(req.params.id) ?? 0 }, req.userId)));
  app.get('/api/users/:id/reposts', optionalAuth, async (req, res) => res.json(await userReposts(parseId(req.params.id) ?? 0, req.userId)));
}
