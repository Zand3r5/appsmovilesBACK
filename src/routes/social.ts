import type { Express } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  getFriends,
  getFriendshipStatus,
  getPendingFriendRequests,
  removeFriendship,
  respondToFriendRequest,
  sendFriendRequest,
} from '../services/social';
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notifications';
import { requireId } from '../utils/validation';

export function socialRoutes(app: Express) {
  app.get('/api/friendships/status/:userId', requireAuth, async (req, res) => {
    res.json(await getFriendshipStatus(req.userId!, requireId(req.params.userId)));
  });
  app.post('/api/friendships', requireAuth, async (req, res) => {
    res.status(201).json(await sendFriendRequest(req.userId!, requireId(req.body?.toId)));
  });
  app.patch('/api/friendships/:id', requireAuth, async (req, res) => {
    await respondToFriendRequest(req.userId!, requireId(req.params.id), req.body?.accept);
    res.status(204).end();
  });
  app.delete('/api/friendships/:id', requireAuth, async (req, res) => {
    await removeFriendship(req.userId!, requireId(req.params.id));
    res.status(204).end();
  });
  app.get('/api/friendships/pending', requireAuth, async (req, res) => {
    res.json(await getPendingFriendRequests(req.userId!));
  });
  app.get('/api/friendships', requireAuth, async (req, res) => {
    res.json(await getFriends(req.userId!));
  });
  app.get('/api/notifications', requireAuth, async (req, res) => {
    res.json(await getNotifications(req.userId!));
  });
  app.patch('/api/notifications/read-all', requireAuth, async (req, res) => {
    await markAllNotificationsRead(req.userId!);
    res.status(204).end();
  });
  app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
    res.json(await markNotificationRead(req.userId!, requireId(req.params.id)));
  });
}
