import { prisma } from '../prisma';
import { publicUserSelect } from './userShapes';
import { fail } from '../utils/http';
import { imageReference } from './uploads';
import { getFriendIds } from './social';
import { withUserPoints } from './points';
import { awardAchievements } from './gamification';
import { createNotification } from './notifications';
import { validateReviewInput } from '../validation/reviews';

export const reviewInclude = {
  author: { select: { ...publicUserSelect, _count: { select: { reviews: { where: { movie: { hidden: false } } } } } } },
  movie: { include: { genres: true } },
  likes: { select: { userId: true } },
  reposts: { select: { userId: true } },
} as const;

export function reviewDTO(review: any, viewerId?: number) {
  return {
    id: review.id,
    text: review.text,
    rating: review.rating,
    photo: review.photo,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    author: {
      id: review.author.id,
      name: review.author.name,
      role: review.author.role,
      reviewCount: review.author._count?.reviews ?? 0,
    },
    likes: review.likes.length,
    reposts: review.reposts.length,
    liked: review.likes.some((like: any) => like.userId === viewerId),
    reposted: review.reposts.some((repost: any) => repost.userId === viewerId),
    movie: {
      id: review.movie.id,
      title: review.movie.title,
      releaseDate: review.movie.releaseDate,
      genres: review.movie.genres.map((genre: any) => genre.name),
      posterUrl: review.movie.posterPath?.startsWith('/') && !review.movie.posterPath.startsWith('/media/')
        ? `https://image.tmdb.org/t/p/w500${review.movie.posterPath}`
        : review.movie.posterPath,
    },
  };
}

export function findReviewRows(where: any, popular = false) {
  return prisma.review.findMany({
    where: { movie: { hidden: false }, ...where },
    include: reviewInclude,
    orderBy: popular ? [{ likes: { _count: 'desc' as const } }, { createdAt: 'desc' as const }] : { createdAt: 'desc' as const },
  });
}

export async function listReviews(where: any, viewerId?: number, popular = false) {
  return (await findReviewRows(where, popular)).map(review => reviewDTO(review, viewerId));
}

export async function createReview(userId: number, movieId: number, body: unknown) {
  if (!await prisma.movie.findFirst({ where: { id: movieId, hidden: false } })) fail(404, 'Película no encontrada');
  const input = validateReviewInput(body);
  const photo = await imageReference(input.photo, userId);
  return withUserPoints(userId, async tx => {
    const review = await tx.review.create({
      data: { ...input, photo, movieId, authorId: userId },
      include: reviewInclude,
    });
    await awardAchievements(tx, userId);
    return reviewDTO(review, userId);
  });
}

export async function updateReview(userId: number, id: number, body: unknown) {
  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) fail(404, 'Reseña no encontrada');
  if (existing.authorId !== userId) fail(403, 'No tenés permiso para editar esta reseña');
  const input = validateReviewInput(body);
  const photo = await imageReference(input.photo, userId);
  return withUserPoints(userId, async tx => {
    const review = await tx.review.update({ where: { id: existing.id }, data: { ...input, photo }, include: reviewInclude });
    await awardAchievements(tx, userId);
    return reviewDTO(review, userId);
  });
}

export async function deleteReview(userId: number, userRole: string, id: number) {
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) fail(404, 'Reseña no encontrada');
  if (review.authorId !== userId && !['moderator', 'superadmin'].includes(userRole)) fail(403, 'No tenés permiso');
  await prisma.review.delete({ where: { id: review.id } });
}

export async function toggleReviewReaction(userId: number, reviewId: number, kind: 'like' | 'repost') {
  const owner = await prisma.review.findUnique({ where: { id: reviewId }, select: { authorId: true } });
  if (!owner) fail(404, 'Reseña no encontrada');
  if (owner.authorId === userId) fail(403, 'No podés reaccionar a tu propia reseña');
  return withUserPoints(owner.authorId, async tx => {
    const review = await tx.review.findUnique({ where: { id: reviewId } });
    if (!review) fail(404, 'Reseña no encontrada');
    const where = { userId_reviewId: { userId, reviewId } };
    const existing = kind === 'like' ? await tx.like.findUnique({ where }) : await tx.repost.findUnique({ where });
    const type = kind === 'like' ? 'review_like' : 'review_repost';
    if (existing) {
      if (kind === 'like') await tx.like.delete({ where });
      else await tx.repost.delete({ where });
      await tx.notification.deleteMany({ where: { actorId: userId, reviewId, type } });
    } else {
      if (kind === 'like') await tx.like.create({ data: { userId, reviewId } });
      else await tx.repost.create({ data: { userId, reviewId } });
      await createNotification(tx, { actorId: userId, recipientId: review.authorId, reviewId, type });
      if (kind === 'like') await awardAchievements(tx, owner.authorId);
    }
    const updated = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude });
    return {
      comment: reviewDTO(updated, userId),
      [kind === 'like' ? 'liked' : 'reposted']: !existing,
    };
  });
}

export async function listPopularReviews(viewerId?: number) {
  return (await listReviews({}, viewerId, true)).slice(0, 10);
}

export async function listFriendsFeed(userId: number) {
  const friendIds = await getFriendIds(userId);
  if (!friendIds.length) return [];
  const [reviews, reposts] = await Promise.all([
    prisma.review.findMany({
      where: { authorId: { in: friendIds }, movie: { hidden: false } },
      include: reviewInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.repost.findMany({
      where: { userId: { in: friendIds }, review: { authorId: { not: userId }, movie: { hidden: false } } },
      include: { user: { select: publicUserSelect }, review: { include: reviewInclude } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  const items = [
    ...reviews.map(review => ({ at: review.createdAt, review: reviewDTO(review, userId) })),
    ...reposts.map(repost => ({ at: repost.createdAt, review: { ...reviewDTO(repost.review, userId), repostedBy: repost.user } })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const seen = new Set<number>();
  return items.filter(item => !seen.has(item.review.id) && Boolean(seen.add(item.review.id))).slice(0, 50).map(item => item.review);
}
