import { prisma } from '../prisma';
import { publicUserSelect } from '../middlewares/auth';
export const reviewInclude = {
  author: { select: publicUserSelect }, movie: { include: { genres: true } },
  likes: { select: { userId: true } }, reposts: { select: { userId: true } },
} as const;
export function reviewDTO(r: any, userId?: number) {
  return { id: r.id, text: r.text, rating: r.rating, photo: r.photo, createdAt: r.createdAt, updatedAt: r.updatedAt,
    author: r.author, likes: r.likes.length, reposts: r.reposts.length,
    liked: r.likes.some((x: any) => x.userId === userId), reposted: r.reposts.some((x: any) => x.userId === userId),
    movie: { id: r.movie.id, title: r.movie.title, releaseDate: r.movie.releaseDate,
      genres: r.movie.genres.map((g: any) => g.name),
      posterUrl: r.movie.posterPath?.startsWith('/') && !r.movie.posterPath.startsWith('/media/') ? `https://image.tmdb.org/t/p/w500${r.movie.posterPath}` : r.movie.posterPath },
  };
}
export async function listReviews(where: any, userId?: number, popular = false) {
  const rows = await prisma.review.findMany({ where: { movie: { hidden: false }, ...where }, include: reviewInclude,
    orderBy: popular ? [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }] : { createdAt: 'desc' },
  });
  return rows.map(r => reviewDTO(r, userId));
}
