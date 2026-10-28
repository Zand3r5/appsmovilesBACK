import type { Express } from 'express';
import { requireAuth } from '../middlewares/auth';
import { movieId } from '../validation/movies';
import { fail } from '../utils/http';
import { walletAvailability, createWalletLink } from '../services/wallet';
export function walletRoutes(app: Express) {
  app.get('/api/wallet/status', requireAuth, async (_req, res) => res.json(await walletAvailability()));
  app.post('/api/rewards/redemptions/:id/wallet', requireAuth, async (req, res) => {
    const provider = req.body?.provider;
    if (!['apple', 'google'].includes(provider)) fail(400, 'Elegí Apple Wallet o Google Wallet');
    res.json(await createWalletLink(req.userId!, movieId(req.params.id), provider));
  });
  app.get('/api/wallet/apple/:id.pkpass', (_req, _res) => fail(503, 'Apple Wallet no está disponible en esta entrega'));
}
