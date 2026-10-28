// El usuario autenticado determina el autor; no confiamos en un id enviado por el cliente.
import type { Express } from 'express';
import { prisma } from '../prisma';
import { optionalAuth, requireAuth } from '../middlewares/auth';
import { cleanText, isPhoto, isRating, parseId } from '../utils/validation';
import { fail } from '../utils/http';
import { listReviews, reviewDTO, reviewInclude } from '../services/reviews';
import { imageReference } from '../services/uploads';
import { getFriendIds } from '../services/social';

import { awardAchievements } from '../services/gamification';

function reviewInput(body: any) {
  const text = cleanText(body?.text, 5000);
  if (!text || !isRating(body?.rating) || !isPhoto(body?.photo)) fail(400, 'Reseña inválida: revisá texto, puntaje y foto');
  return { text: text!, rating: body.rating as number, photo: body.photo ?? null };
}
export function reviewRoutes(app: Express) {
  app.get('/api/movies/:id/reviews', optionalAuth, async (req, res) => res.json(await listReviews({ movieId: parseId(req.params.id) ?? 0 }, req.userId)));
  app.post('/api/movies/:id/reviews', requireAuth, async (req, res) => {
    const data = reviewInput(req.body), movieId = parseId(req.params.id);
    if (!movieId || !await prisma.movie.findFirst({ where: { id: movieId, hidden: false } })) fail(404, 'Película no encontrada');
    data.photo = await imageReference(data.photo, req.userId!) ?? null;
    try {
      const r = await prisma.review.create({ data: { ...data, movieId: movieId!, authorId: req.userId! }, include: reviewInclude });
      await awardAchievements(req.userId!);
      res.status(201).json(reviewDTO(r, req.userId));
    } catch (e: any) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'Ya reseñaste esta película. Podés editar tu reseña existente.', code: 'REVIEW_ALREADY_EXISTS' });
      throw e;
    }
  });
  app.patch('/api/reviews/:id', requireAuth, async (req, res) => {
    const id = parseId(req.params.id), data = reviewInput(req.body);
    const review = await prisma.review.findUnique({ where: { id: id ?? 0 } });
    if (!review) fail(404, 'Reseña no encontrada');
    if (review.authorId !== req.userId) fail(403, 'No tenés permiso para editar esta reseña');
    data.photo = await imageReference(data.photo, req.userId!) ?? null;
    const updated = await prisma.review.update({ where: { id: review.id }, data, include: reviewInclude });
    await awardAchievements(review.authorId);
    res.json(reviewDTO(updated, req.userId));
  });
  app.delete('/api/reviews/:id', requireAuth, async (req, res) => {
    const review = await prisma.review.findUnique({ where: { id: parseId(req.params.id) ?? 0 } });
    if (!review) fail(404, 'Reseña no encontrada');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (review.authorId !== user.id && !['moderator', 'superadmin'].includes(user.role)) fail(403, 'No tenés permiso');
    await prisma.review.delete({ where: { id: review.id } });
    await awardAchievements(review.authorId);
    res.status(204).end();
  });
  app.post('/api/reviews/:id/like', requireAuth, async (req, res) => {
    const reviewId = parseId(req.params.id) ?? 0, userId = req.userId!;
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) fail(404, 'Reseña no encontrada');
    // Una reseña propia no se puede likear.
    if (review.authorId === userId) fail(403, 'No podés dar me gusta a tu propia reseña');
    const result = await prisma.$transaction(async tx => {
      const where = { userId_reviewId: { userId, reviewId } };
      const existing = await tx.like.findUnique({ where });
      if (existing) {
        await tx.like.delete({ where });
        await tx.notification.deleteMany({ where: { actorId: userId, reviewId, type: 'review_like' } });
      } else {
        await tx.like.create({ data: { userId, reviewId } });
        if (review.authorId !== userId) await tx.notification.create({ data: { actorId: userId, recipientId: review.authorId, reviewId, type: 'review_like' } });
      }
      const updated = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude });
      return { comment: reviewDTO(updated, userId), liked: !existing };
    });
    await awardAchievements(review.authorId);
    res.json(result);
  });
  app.post('/api/reviews/:id/repost', requireAuth, async (req, res) => {
    const reviewId = parseId(req.params.id) ?? 0, userId = req.userId!;
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) fail(404, 'Reseña no encontrada');
    // Una reseña propia no se puede repostear.
    if (review.authorId === userId) fail(403, 'No podés repostear tu propia reseña');
    const result = await prisma.$transaction(async tx => {
      const where = { userId_reviewId: { userId, reviewId } };
      const existing = await tx.repost.findUnique({ where });
      if (existing) {
        await tx.repost.delete({ where });
        await tx.notification.deleteMany({ where: { actorId: userId, reviewId, type: 'review_repost' } });
      } else {
        await tx.repost.create({ data: { userId, reviewId } });
        if (review.authorId !== userId) await tx.notification.create({ data: { actorId: userId, recipientId: review.authorId, reviewId, type: 'review_repost' } });
      }
      const updated = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude });
      return { comment: reviewDTO(updated, userId), reposted: !existing };
    });
    await awardAchievements(review.authorId);
    res.json(result);
  });
  app.get('/api/feed/popular', optionalAuth, async (req, res) => res.json((await listReviews({}, req.userId, true)).slice(0, 10)));
  app.get('/api/feed/friends', requireAuth, async (req, res) => res.json((await listReviews({ authorId: { in: await getFriendIds(req.userId!) } }, req.userId)).slice(0, 10)));
}
