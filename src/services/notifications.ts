import type { Prisma } from '@prisma/client';

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
