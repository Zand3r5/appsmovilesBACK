import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
const stop = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));
test('Push registration, due-time dispatch, deduplication, receipts, retries and logout', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-push-'));
  const db = path.join(dir, 'test.db'); await writeFile(db, '');
  process.env.DATABASE_URL = `file:${db}`; process.env.JWT_SECRET = 'push-test-only-123456789'; process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  let sends = 0, fail = false, receiptError = false;
  const expo = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (fail) { res.statusCode = 503; return res.end('{}'); }
    if (req.url === '/send') { sends++; return res.end(JSON.stringify({ data: [{ status: 'ok', id: `ticket-${sends}` }] })); }
    const ids = JSON.parse(body).ids;
    res.end(JSON.stringify({ data: Object.fromEntries(ids.map((id: string) => [id, receiptError ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }])) }));
  });
  await new Promise<void>(resolve => expo.listen(0, '127.0.0.1', resolve));
  process.env.EXPO_PUSH_BASE_URL = `http://127.0.0.1:${(expo.address() as any).port}`;
  const { createApp } = await import('../src/index'); const { prisma } = await import('../src/prisma'); const { runPushDelivery } = await import('../src/services/push');
  const api = createApp().listen(); await new Promise<void>(resolve => api.once('listening', resolve));
  const base = `http://127.0.0.1:${(api.address() as any).port}/api`;
  async function call(route: string, method: string, body: any, token?: string) {
    const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  }
  try {
    const user = (await call('/auth/register', 'POST', { name: 'Push User', email: 'push@example.test', password: 'Testing1234' })).data;
    await prisma.session.updateMany({ data: { expiresAt: new Date('2080-01-01') } });
    const device = { id: randomUUID(), secret: 'a'.repeat(64), token: 'ExpoPushToken[fixture]', platform: 'android' };
    assert.equal((await call('/push/devices', 'PUT', device)).status, 401);
    assert.equal((await call('/push/devices', 'PUT', { ...device, token: 'bad' }, user.token)).status, 400);
    assert.equal((await call('/push/devices', 'PUT', device, user.token)).status, 200);
    assert.equal((await call('/push/devices', 'PUT', { ...device, secret: 'b'.repeat(64) }, user.token)).status, 403);
    const diagnostic = await call('/push/status', 'GET', undefined, user.token);
    assert.equal(diagnostic.status, 200); assert.equal(diagnostic.data.devices.length, 1);
    assert.ok(!JSON.stringify(diagnostic.data).includes(device.token));
    assert.equal((await call('/push/test', 'POST', {}, user.token)).data.accepted, 1);
    assert.equal(sends, 1);
    assert.equal((await call('/push/test', 'POST', {}, user.token)).status, 429);
    sends = 0;
    const movie = await prisma.movie.create({ data: { title: 'Push release', overview: '', releaseDate: '2030-01-10' } });
    assert.equal((await call(`/reminders/${movie.id}`, 'PUT', {}, user.token)).status, 200);
    await runPushDelivery(new Date('2030-01-10T12:59:00Z')); assert.equal(sends, 0);
    await runPushDelivery(new Date('2030-01-10T13:01:00Z')); assert.equal(sends, 1);
    await runPushDelivery(new Date('2030-01-10T13:02:00Z')); assert.equal(sends, 1);
    await runPushDelivery(new Date('2030-01-10T13:17:00Z'));
    assert.equal((await prisma.pushDelivery.findFirstOrThrow()).status, 'delivered');
    await prisma.movie.update({ where: { id: movie.id }, data: { releaseDate: '2030-01-11' } });
    fail = true; await runPushDelivery(new Date('2030-01-11T13:01:00Z'));
    const pending = await prisma.pushDelivery.findFirstOrThrow({ where: { releaseDate: '2030-01-11' } });
    assert.equal(pending.status, 'pending'); assert.equal(pending.attempts, 1);
    fail = false; await runPushDelivery(new Date('2030-01-11T13:04:00Z')); assert.equal(sends, 2);
    receiptError = true; await runPushDelivery(new Date('2030-01-11T13:20:00Z'));
    assert.equal((await prisma.pushDevice.findUniqueOrThrow({ where: { id: device.id } })).enabled, false);
    await call('/push/devices', 'PUT', device, user.token);
    await call('/auth/logout', 'POST', undefined, user.token);
    assert.equal(await prisma.pushDevice.count(), 0);
    await prisma.movie.update({ where: { id: movie.id }, data: { releaseDate: '2030-01-12' } });
    await runPushDelivery(new Date('2030-01-12T13:01:00Z')); assert.equal(sends, 2);
  } finally { await stop(api); await stop(expo); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
