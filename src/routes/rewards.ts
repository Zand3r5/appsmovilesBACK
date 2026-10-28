// El costo se consulta en Reward; el teléfono no decide cuánto se descuenta.
import { prisma } from '../prisma';
import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAuth, requireRole } from '../middlewares/auth';
import { getAchievements, getRewards, awardAchievements } from '../services/gamification';
import { validateRedemption, useRedemption, refundRedemption, cancelRedemption } from '../services/fulfillment';
import { movieId } from '../validation/movies';
import { fail } from '../utils/http';
import { pointsSummary } from '../services/points';
export function rewardRoutes(app: Express) {
  app.post('/api/admin/redemptions/validate', requireAuth, requireRole('moderator', 'superadmin'), async (req, res) => res.json(await validateRedemption(req.body?.code)));
  app.post('/api/admin/redemptions/use', requireAuth, requireRole('moderator', 'superadmin'), async (req, res) => res.json(await useRedemption(req.body?.code, req.userId!)));
  app.post('/api/admin/redemptions/:id/refund', requireAuth, requireRole('superadmin'), async (req, res) => res.json(await refundRedemption(movieId(req.params.id), req.userId!)));

  app.delete('/api/rewards/redemptions/:id', requireAuth, async (req, res) => {
    res.json(await cancelRedemption(movieId(req.params.id), req.userId!));
  });

  app.get('/api/points', requireAuth, async (req, res) => {
    const before = req.query.before === undefined ? undefined : movieId(req.query.before);
    const entries = await prisma.pointEntry.findMany({ where: { userId: req.userId!, ...(before ? { id: { lt: before } } : {}) }, orderBy: { id: 'desc' }, take: 51 });
    res.json({ ...await pointsSummary(req.userId!), entries: entries.slice(0,50), nextCursor: entries.length > 50 ? entries[49].id : null });
  });

  app.get('/api/achievements', requireAuth, async (req, res) => res.json(await getAchievements(req.userId!)));
  app.get('/api/rewards', requireAuth, async (req, res) => res.json(await getRewards(req.userId!)));
  app.post('/api/rewards/redeem', requireAuth, async (req, res) => {
    const reward = typeof req.body?.rewardId === 'string' ? await prisma.reward.findUnique({ where: { id: req.body.rewardId } }) : null;
    if (!reward) fail(400, 'Premio no válido');
    await awardAchievements(req.userId!);
    const redemption = await prisma.$transaction(async tx => {
      const paid = await tx.user.updateMany({ where: { id: req.userId!, points: { gte: reward.cost } }, data: { points: { decrement: reward.cost } } });
      if (!paid.count) fail(409, 'No te alcanzan los puntos');
      const saved = await tx.redemption.create({ data: { userId: req.userId!, rewardId: reward.id, cost: reward.cost, code: randomBytes(8).toString('hex').toUpperCase(), expiresAt: new Date(Date.now() + 30 * 86400000) } });
      await tx.pointEntry.create({ data: { userId: req.userId!, kind: 'redemption', amount: -reward.cost, description: 'Canje: ' + reward.title } });
      return saved;
    });
    const result = { success: true, redemptionId: redemption.id, code: redemption.code, rewards: await getRewards(req.userId!) };
    res.status(201).json(result);
  });
}
