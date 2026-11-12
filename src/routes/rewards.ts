import type { Express } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth';
import { getAchievements, getPoints, getRewards, redeemReward } from '../services/gamification';
import { validateRedemption, useRedemption, refundRedemption, cancelRedemption } from '../services/fulfillment';
import { requireId } from '../utils/validation';

export function rewardRoutes(app: Express) {
  app.post('/api/admin/redemptions/validate', requireAuth, requireRole('moderator', 'superadmin'), async (req, res) => res.json(await validateRedemption(req.body?.code)));
  app.post('/api/admin/redemptions/use', requireAuth, requireRole('moderator', 'superadmin'), async (req, res) => res.json(await useRedemption(req.body?.code, req.userId!)));
  app.post('/api/admin/redemptions/:id/refund', requireAuth, requireRole('superadmin'), async (req, res) => res.json(await refundRedemption(requireId(req.params.id), req.userId!)));

  app.delete('/api/rewards/redemptions/:id', requireAuth, async (req, res) => {
    res.json(await cancelRedemption(requireId(req.params.id), req.userId!));
  });

  app.get('/api/points', requireAuth, async (req, res) => {
    const before = req.query.before === undefined ? undefined : requireId(req.query.before);
    res.json(await getPoints(req.userId!, before));
  });

  app.get('/api/achievements', requireAuth, async (req, res) => res.json(await getAchievements(req.userId!)));
  app.get('/api/rewards', requireAuth, async (req, res) => res.json(await getRewards(req.userId!)));
  app.post('/api/rewards/redeem', requireAuth, async (req, res) => {
    const result = await redeemReward(req.userId!, req.body?.rewardId);
    res.status(201).json(result);
  });
}
