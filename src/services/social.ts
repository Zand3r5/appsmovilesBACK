import { prisma } from "../prisma";

// Ids de mis amigos (amistades aceptadas, en cualquier dirección)
export async function getFriendIds(userId: number) {
  const rows = await prisma.friendship.findMany({
    where: { status: "accepted", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
}

// promedio de mis amigos para varias películas, en UNA consulta
export async function getFriendsRatings(userId: number | undefined, movieIds: number[]) {
  const result = new Map<number, { rating: number; count: number }>();
  if (!userId || movieIds.length === 0) return result;
  const friendIds = await getFriendIds(userId);
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