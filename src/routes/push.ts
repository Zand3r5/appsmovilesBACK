import type { Express } from 'express';
import { requireAuth } from '../middlewares/auth';
import rateLimit from 'express-rate-limit';
import { registerPushDevice, unregisterPushDevice, pushDeviceStatus, sendPushTest } from '../services/push';
export function pushRoutes(app: Express) {
  app.get('/api/push/status', requireAuth, async (req, res) => res.json(await pushDeviceStatus(req.userId!, req.sessionId!)));
  app.post('/api/push/test', requireAuth, rateLimit({ windowMs: 60000, limit: 1, keyGenerator: req => String(req.userId), message: { error: 'Esperá un minuto antes de enviar otra prueba' } }), async (req, res) => res.json(await sendPushTest(req.userId!, req.sessionId!)));
  app.put('/api/push/devices', requireAuth, async (req, res) => res.json(await registerPushDevice(req.userId!, req.sessionId!, req.body)));
  app.delete('/api/push/devices/:id', requireAuth, async (req, res) => {
    await unregisterPushDevice(req.userId!, String(req.params.id), req.body?.secret); res.status(204).end();
  });
}
