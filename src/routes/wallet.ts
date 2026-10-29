import type { Express } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middlewares/auth';
import { movieId } from '../validation/movies';
import { fail } from '../utils/http';
import { walletAvailability, createWalletLink, authorizeAppleDownload, applePass } from '../services/wallet';
export function walletRoutes(app: Express) {
  app.get('/api/wallet/status', requireAuth, async (_req, res) => res.json(await walletAvailability()));
  app.post('/api/rewards/redemptions/:id/wallet', requireAuth, rateLimit({ windowMs: 60000, limit: 15 }), async (req, res) => {
    const provider = req.body?.provider;
    if (!['apple', 'google'].includes(provider)) fail(400, 'Elegí Apple Wallet o Google Wallet');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await createWalletLink(req.userId!, req.sessionId!, movieId(req.params.id), provider));
  });
  app.get('/api/wallet/apple/:id.pkpass', rateLimit({ windowMs: 60000, limit: 30 }), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    const id = movieId(req.params.id), row = await authorizeAppleDownload(id, req.query.ticket);
    const pass = await applePass(row);
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `inline; filename="whatnext-${id}.pkpass"`);
    res.send(pass);
  });
}
