import type { Express } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAuth, requireRole } from '../middlewares/auth';
import { getAchievements, getRewards } from '../services/gamification';
import { validateRedemption, useRedemption, refundRedemption, cancelRedemption } from '../services/fulfillment';
import { movieId } from '../validation/movies';
import { fail } from '../utils/http';
import { recordPoints, pointsSummary, withUserPoints } from '../services/points';
export function rewardRoutes(app: Express) {
  app.post('/api/admin/redemptions/validate', requireAuth, requireRole('moderator', 'superadmin'), async (req, res) => res.json(await validateRedemption(req.body?.code)));
  app.post('/api/admin/redemptions/use', requireAuth, requireRole('moderator', 'superadmin'), async (req, res) => res.json(await useRedemption(req.body?.code, req.userId!)));
  app.post('/api/admin/redemptions/:id/refund', requireAuth, requireRole('superadmin'), async (req, res) => res.json(await refundRedemption(movieId(req.params.id), req.userId!)));

  app.delete('/api/rewards/redemptions/:id', requireAuth, async (req, res) => {
    res.json(await cancelRedemption(movieId(req.params.id), req.userId!));
  });

  app.get('/api/points', requireAuth, async (req, res) => {
    const before = req.query.before === undefined ? undefined : movieId(req.query.before);
    res.json(await withUserPoints(req.userId!, async tx => {
      await getAchievements(req.userId!, tx);
      const entries = await tx.pointEntry.findMany({ where: { userId: req.userId!, ...(before ? { id: { lt: before } } : {}) }, orderBy: { id: 'desc' }, take: 51 });
      return { ...await pointsSummary(tx, req.userId!), entries: entries.slice(0, 50), nextCursor: entries.length > 50 ? entries[49].id : null };
    }));
  });

  app.get('/api/achievements', requireAuth, async (req, res) => res.json(await getAchievements(req.userId!)));
  app.get('/api/rewards', requireAuth, async (req, res) => res.json(await getRewards(req.userId!)));
  app.post('/api/rewards/redeem', requireAuth, async (req, res) => {
    const result = await withUserPoints(req.userId!, async tx => {
      const reward = typeof req.body?.rewardId === 'string' ? await tx.reward.findUnique({ where: { id: req.body.rewardId } }) : null;
      if (!reward || !Number.isInteger(reward.cost) || reward.cost <= 0) fail(400, 'Premio no válido');
      await getAchievements(req.userId!, tx);
      const balance = await pointsSummary(tx, req.userId!);
      if (balance.balance < reward.cost) fail(409, 'No te alcanzan los puntos');
      const redemption = await tx.redemption.create({ data: { userId: req.userId!, rewardId: reward.id, cost: reward.cost, code: randomBytes(8).toString('hex').toUpperCase(), expiresAt: new Date(Date.now() + 30 * 86400000) } });
      await recordPoints(tx, req.userId!, `redemption:${redemption.id}`, 'redemption', -reward.cost, `Canje: ${reward.title}`, redemption.createdAt);
      return { success: true, redemptionId: redemption.id, code: redemption.code, rewards: await getRewards(req.userId!, tx) };
    });
    res.status(201).json(result);
  });
}
