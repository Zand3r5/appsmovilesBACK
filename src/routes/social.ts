import type { Express } from 'express';
import { prisma } from '../prisma';
import { publicUserSelect, requireAuth } from '../middlewares/auth';
import { parseId } from '../utils/validation';
import { fail } from '../utils/http';
const friendshipInclude = { requester: { select: publicUserSelect }, addressee: { select: publicUserSelect } } as const;
export function socialRoutes(app: Express) {
  app.get('/api/friendships/status/:userId', requireAuth, async (req, res) => {
    const id = parseId(req.params.userId) ?? 0, me = req.userId!;
    const f = await prisma.friendship.findUnique({ where: { userLowId_userHighId: { userLowId: Math.min(me, id), userHighId: Math.max(me, id) } } });
    res.json(!f ? { status: 'none' } : { status: f.status === 'accepted' ? 'friends' : f.requesterId === me ? 'sent' : 'received', requestId: f.id });
  });
  app.post('/api/friendships', requireAuth, async (req, res) => {
    const toId = parseId(req.body?.toId), me = req.userId!;
    if (!toId || toId === me) fail(400, 'Elegí otro usuario');
    if (!await prisma.user.findUnique({ where: { id: toId! } })) fail(404, 'Usuario no encontrado');
    const request = await prisma.$transaction(async tx => {
      const f = await tx.friendship.create({ data: { requesterId: me, addresseeId: toId!, userLowId: Math.min(me, toId!), userHighId: Math.max(me, toId!) } });
      await tx.notification.create({ data: { type: 'friend_request', recipientId: toId!, actorId: me, friendshipId: f.id } });
      return f;
    });
    res.status(201).json(request);
  });
  app.patch('/api/friendships/:id', requireAuth, async (req, res) => {
    if (typeof req.body?.accept !== 'boolean') fail(400, 'Indicá si aceptás la solicitud');
    await prisma.$transaction(async tx => {
      const f = await tx.friendship.findUnique({ where: { id: parseId(req.params.id) ?? 0 } });
      if (!f || f.status !== 'pending') fail(404, 'La solicitud ya no existe');
      if (f.addresseeId !== req.userId) fail(403, 'No tenés permiso');
      await tx.notification.updateMany({ where: { friendshipId: f.id, recipientId: req.userId }, data: { read: true } });
      if (req.body.accept) await tx.friendship.update({ where: { id: f.id }, data: { status: 'accepted' } });
      else {
        await tx.notification.deleteMany({ where: { friendshipId: f.id } });
        await tx.friendship.delete({ where: { id: f.id } });
      }
    });
    res.status(204).end();
  });
  app.delete('/api/friendships/:id', requireAuth, async (req, res) => {
    await prisma.$transaction(async tx => {
      const f = await tx.friendship.findUnique({ where: { id: parseId(req.params.id) ?? 0 } });
      if (!f) fail(404, 'Amistad no encontrada');
      if (f.requesterId !== req.userId && f.addresseeId !== req.userId) fail(403, 'No tenés permiso');
      await tx.notification.deleteMany({ where: { friendshipId: f.id } });
      await tx.friendship.delete({ where: { id: f.id } });
    });
    res.status(204).end();
  });
  app.get('/api/friendships/pending', requireAuth, async (req, res) => {
    const rows = await prisma.friendship.findMany({ where: { addresseeId: req.userId, status: 'pending' }, include: friendshipInclude });
    res.json(rows.map(f => ({ id: f.id, from: f.requester, createdAt: f.createdAt })));
  });
  app.get('/api/friendships', requireAuth, async (req, res) => {
    const rows = await prisma.friendship.findMany({ where: { status: 'accepted', OR: [{ requesterId: req.userId }, { addresseeId: req.userId }] }, include: friendshipInclude });
    res.json(rows.map(f => ({ requestId: f.id, ...(f.requesterId === req.userId ? f.addressee : f.requester) })));
  });
  app.get('/api/notifications', requireAuth, async (req, res) => {
    const rows = await prisma.notification.findMany({ where: { recipientId: req.userId }, include: { actor: { select: publicUserSelect }, review: { select: { movie: { select: { id: true, title: true } } } } }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map(n => ({ id: n.id, type: n.type, read: n.read, createdAt: n.createdAt, actor: n.actor, commentId: n.reviewId, movie: n.review?.movie ?? null })));
  });
  app.patch('/api/notifications/read-all', requireAuth, async (req, res) => {
    await prisma.notification.updateMany({ where: { recipientId: req.userId }, data: { read: true } });
    res.status(204).end();
  });
  app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
    const result = await prisma.notification.updateMany({ where: { id: parseId(req.params.id) ?? 0, recipientId: req.userId }, data: { read: true } });
    if (!result.count) fail(404, 'Notificación no encontrada');
    res.json({ id: Number(req.params.id), read: true });
  });
}
