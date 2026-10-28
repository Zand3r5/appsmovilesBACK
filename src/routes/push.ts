import type { Express } from 'express';
import { requireAuth } from '../middlewares/auth';

import { registerPushDevice, unregisterPushDevice, pushDeviceStatus, sendPushTest } from '../services/push';
export function pushRoutes(app: Express) {
  app.get('/api/push/status', requireAuth, async (req, res) => res.json(await pushDeviceStatus(req.userId!)));
  app.post('/api/push/test', requireAuth, async (req, res) => res.json(await sendPushTest(req.userId!)));
  app.put('/api/push/devices', requireAuth, async (req, res) => res.json(await registerPushDevice(req.userId!, req.body)));
  app.delete('/api/push/devices/:id', requireAuth, async (req, res) => {
    await unregisterPushDevice(req.userId!, String(req.params.id), req.body?.secret); res.status(204).end();
  });
}
