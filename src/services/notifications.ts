import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { publicUserSelect } from '../middlewares/auth';
import { parseId } from '../utils/validation';
import { fail } from '../utils/http';

type NotificationInput = {
  recipientId: number;
  actorId: number;
  type: 'friend_request' | 'review_like' | 'review_repost';
  reviewId?: number;
  friendshipId?: number;
};

export function createNotification(tx: Prisma.TransactionClient, data: NotificationInput) {
  return tx.notification.create({ data });
}

export async function getNotifications(userId: number) {
  const rows = await prisma.notification.findMany({
    where: { recipientId: userId },
    include: {
      actor: { select: publicUserSelect },
      review: { select: { movie: { select: { id: true, title: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    read: row.read,
    createdAt: row.createdAt,
    actor: row.actor,
    commentId: row.reviewId,
    movie: row.review?.movie ?? null,
  }));
}

export function markAllNotificationsRead(userId: number) {
  return prisma.notification.updateMany({ where: { recipientId: userId }, data: { read: true } });
}

export async function markNotificationRead(userId: number, notificationValue: unknown) {
  const id = parseId(notificationValue) ?? 0;
  const result = await prisma.notification.updateMany({ where: { id, recipientId: userId }, data: { read: true } });
  if (!result.count) fail(404, 'Notificación no encontrada');
  return { id, read: true };
}