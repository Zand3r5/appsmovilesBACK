import { prisma } from "../prisma";
import { publicUserSelect } from '../middlewares/auth';
import { fail } from '../utils/http';
import { parseId } from '../utils/validation';
import { createNotification } from './notifications';

const friendshipInclude = {
  requester: { select: publicUserSelect },
  addressee: { select: publicUserSelect },
} as const;

// Ids de mis amigos (amistades aceptadas, en cualquier dirección)
export async function getFriendIds(userId: number) {
  const rows = await prisma.friendship.findMany({
    where: { status: "accepted", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
}

// promedio de mis amigos para varias películas, en UNA consulta
export async function getFriendsRatings(userId: number | undefined, movieIds: number[], knownFriendIds?: number[]) {
  const result = new Map<number, { rating: number; count: number }>();
  if (!userId || movieIds.length === 0) return result;
  const friendIds = knownFriendIds ?? await getFriendIds(userId);
  if (friendIds.length === 0) return result;
  const rows = await prisma.review.groupBy({
    by: ["movieId"],
    where: { rating: { not: null }, movieId: { in: movieIds }, authorId: { in: friendIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  for (const r of rows) {
    result.set(r.movieId, { rating: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count._all });
  }
  return result;
}

export async function getFriendshipStatus(userId: number, otherValue: unknown) {
  const otherId = parseId(otherValue) ?? 0;
  const friendship = await prisma.friendship.findUnique({
    where: { userLowId_userHighId: { userLowId: Math.min(userId, otherId), userHighId: Math.max(userId, otherId) } },
  });
  if (!friendship) return { status: 'none' };
  return {
    status: friendship.status === 'accepted' ? 'friends' : friendship.requesterId === userId ? 'sent' : 'received',
    requestId: friendship.id,
  };
}

export async function sendFriendRequest(userId: number, otherValue: unknown) {
  const otherId = parseId(otherValue);
  if (!otherId || otherId === userId) fail(400, 'Elegí otro usuario');
  if (!await prisma.user.findUnique({ where: { id: otherId } })) fail(404, 'Usuario no encontrado');
  return prisma.$transaction(async tx => {
    const friendship = await tx.friendship.create({
      data: {
        requesterId: userId,
        addresseeId: otherId,
        userLowId: Math.min(userId, otherId),
        userHighId: Math.max(userId, otherId),
      },
    });
    await createNotification(tx, {
      type: 'friend_request',
      recipientId: otherId,
      actorId: userId,
      friendshipId: friendship.id,
    });
    return friendship;
  });
}

export async function respondToFriendRequest(userId: number, requestValue: unknown, accept: unknown) {
  if (typeof accept !== 'boolean') fail(400, 'Indicá si aceptás la solicitud');
  await prisma.$transaction(async tx => {
    const friendship = await tx.friendship.findUnique({ where: { id: parseId(requestValue) ?? 0 } });
    if (!friendship || friendship.status !== 'pending') fail(404, 'La solicitud ya no existe');
    if (friendship.addresseeId !== userId) fail(403, 'No tenés permiso');
    await tx.notification.updateMany({ where: { friendshipId: friendship.id, recipientId: userId }, data: { read: true } });
    if (accept) await tx.friendship.update({ where: { id: friendship.id }, data: { status: 'accepted' } });
    else {
      await tx.notification.deleteMany({ where: { friendshipId: friendship.id } });
      await tx.friendship.delete({ where: { id: friendship.id } });
    }
  });
}

export async function removeFriendship(userId: number, requestValue: unknown) {
  await prisma.$transaction(async tx => {
    const friendship = await tx.friendship.findUnique({ where: { id: parseId(requestValue) ?? 0 } });
    if (!friendship) fail(404, 'Amistad no encontrada');
    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) fail(403, 'No tenés permiso');
    await tx.notification.deleteMany({ where: { friendshipId: friendship.id } });
    await tx.friendship.delete({ where: { id: friendship.id } });
  });
}

export async function getPendingFriendRequests(userId: number) {
  const rows = await prisma.friendship.findMany({
    where: { addresseeId: userId, status: 'pending' },
    include: friendshipInclude,
  });
  return rows.map(row => ({ id: row.id, from: row.requester, createdAt: row.createdAt }));
}

export async function getFriends(userId: number) {
  const rows = await prisma.friendship.findMany({
    where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: friendshipInclude,
  });
  return rows.map(row => ({ requestId: row.id, ...(row.requesterId === userId ? row.addressee : row.requester) }));
}