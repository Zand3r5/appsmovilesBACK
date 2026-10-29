import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));

test('Social actions commit a backend outbox and share push delivery, retries and receipts', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-social-push-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  process.env.JWT_SECRET = 'social-push-test-only-secret-123456789';
  process.env.NODE_ENV = 'test';
  await writeFile(path.join(dir, 'test.db'), '');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  let messages: any[] = [], fail = false;
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); res.setHeader('Content-Type', 'application/json');
    if (fail) { res.statusCode = 503; return res.end('{}'); }
    if (req.url === '/send') {
      messages.push(...body);
      return res.end(JSON.stringify({ data: body.map((_: any, i: number) => ({ status: 'ok', id: `ticket-${messages.length}-${i}` })) }));
    }
    res.end(JSON.stringify({ data: Object.fromEntries(body.ids.map((id: string) => [id, { status: 'ok' }])) }));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  process.env.EXPO_PUSH_BASE_URL = `http://127.0.0.1:${(provider.address() as any).port}`;
  const { prisma } = await import('../src/prisma');
  const { createApp } = await import('../src/index');
  const { runPushDelivery } = await import('../src/services/push');
  const api = createApp().listen(); await new Promise<void>(resolve => api.once('listening', resolve));
  const base = `http://127.0.0.1:${(api.address() as any).port}/api`;
  async function call(route: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  let serial = 0;
  const signup = async (name: string) => (await call('/auth/register', 'POST', { name, email: `${name}${++serial}@social.test`, password: 'Testing1234' })).data;
  async function register(user: any, platform = 'android') {
    const device = { id: randomUUID(), secret: 'a'.repeat(64), token: `ExpoPushToken[device_${++serial}]`, platform };
    assert.equal((await call('/push/devices', 'PUT', device, user.token)).status, 200); return device;
  }
  const tick = (minutes = 0) => runPushDelivery(new Date(Date.now() + minutes * 60000 + 100));
  try {
    const owner = await signup('Owner'), actor = await signup('Actor');
    const android = await register(owner), ios = await register(owner, 'ios'); await register(actor);
    const movie = await prisma.movie.create({ data: { title: 'Social movie', overview: '' } });
    const review = await prisma.review.create({ data: { movieId: movie.id, authorId: owner.user.id, text: 'Review' } });
    await t.test('Friend request queues only recipient devices; sender makes no direct provider request', async () => {
      assert.equal((await call('/friendships', 'POST', { toId: owner.user.id }, actor.token)).status, 201);
      assert.equal(messages.length, 0);
      assert.equal(await prisma.pushDelivery.count({ where: { kind: 'social-notification', userId: owner.user.id } }), 2);
      await tick(); assert.equal(messages.length, 2);
      assert.deepEqual(new Set(messages.map(row => row.to)), new Set([android.token, ios.token]));
      assert.ok(messages.every(row => row.data.kind === 'friend-request' && row.data.userId === actor.user.id && row.channelId === 'actividad'));
      await tick(); assert.equal(messages.length, 2);
      await tick(16);
      assert.equal(await prisma.pushDelivery.count({ where: { status: 'delivered' } }), 2);
    });
    await t.test('Likes and reposts go to the review author, with backend-built content and movie destination', async () => {
      assert.equal((await call(`/reviews/${review.id}/like`, 'POST', { recipientId: actor.user.id }, actor.token)).status, 200);
      await tick(); assert.equal(messages.length, 4);
      assert.ok(messages.slice(-2).every(row => row.data.kind === 'review-like' && row.data.movieId === movie.id && row.body.includes('Actor')));
      assert.equal((await call(`/reviews/${review.id}/repost`, 'POST', {}, actor.token)).status, 200);
      await tick(); assert.equal(messages.length, 6);
      assert.ok(messages.slice(-2).every(row => row.data.kind === 'review-repost'));
      const count = await prisma.pushDelivery.count();
      await call(`/reviews/${review.id}/like`, 'POST', {}, owner.token);
      assert.equal(await prisma.pushDelivery.count(), count);
    });
    await t.test('Unlike/re-like and withdraw/re-request loops do not repeatedly alert a device on the same day', async () => {
      await call(`/reviews/${review.id}/like`, 'POST', {}, actor.token);
      await call(`/reviews/${review.id}/like`, 'POST', {}, actor.token);
      const friendship = await prisma.friendship.findFirstOrThrow({ where: { requesterId: actor.user.id } });
      await call(`/friendships/${friendship.id}`, 'DELETE', undefined, actor.token);
      await call('/friendships', 'POST', { toId: owner.user.id }, actor.token);
      await tick(); assert.equal(messages.length, 6);
    });
    await t.test('Reading a notification cancels its pending pushes', async () => {
      const next = await signup('Read');
      await call(`/reviews/${review.id}/like`, 'POST', {}, next.token);
      const notice = await prisma.notification.findFirstOrThrow({ where: { actorId: next.user.id, type: 'review_like' } });
      await call(`/notifications/${notice.id}/read`, 'PATCH', {}, owner.token);
      await tick(); assert.equal(messages.length, 6);
      assert.equal(await prisma.pushDelivery.count({ where: { notificationId: notice.id, status: 'canceled' } }), 2);
    });
    await t.test('Withdrawn and accepted requests, removed likes, and deleted reviews cannot send stale pushes', async () => {
      for (const action of ['withdraw', 'accept']) {
        const next = await signup(action);
        const request = await call('/friendships', 'POST', { toId: owner.user.id }, next.token);
        if (action === 'withdraw') await call(`/friendships/${request.data.id}`, 'DELETE', undefined, next.token);
        else await call(`/friendships/${request.data.id}`, 'PATCH', { accept: true }, owner.token);
      }
      const next = await signup('Unlike');
      await call(`/reviews/${review.id}/like`, 'POST', {}, next.token);
      await call(`/reviews/${review.id}/like`, 'POST', {}, next.token);
      const another = await prisma.movie.create({ data: { title: 'Deleted review', overview: '' } });
      const deleted = await prisma.review.create({ data: { movieId: another.id, authorId: owner.user.id, text: 'Temporary' } });
      await call(`/reviews/${deleted.id}/like`, 'POST', {}, actor.token);
      await call(`/reviews/${deleted.id}`, 'DELETE', undefined, owner.token);
      await tick(); assert.equal(messages.length, 6);
    });
    await t.test('Social messages use the same retry and receipt processing as releases', async () => {
      const next = await signup('Retry');
      const request = await call('/friendships', 'POST', { toId: owner.user.id }, next.token);
      const notice = await prisma.notification.findFirstOrThrow({ where: { friendshipId: request.data.id } });
      fail = true; await tick();
      const rows = await prisma.pushDelivery.findMany({ where: { notificationId: notice.id } });
      assert.ok(rows.every(row => row.status === 'pending' && row.attempts === 1));
      fail = false; await tick(5); assert.equal(messages.length, 8);
      await tick(21);
      assert.equal(await prisma.pushDelivery.count({ where: { notificationId: notice.id, status: 'delivered' } }), 2);
    });
    await t.test('No registered device means in-app only, with no backlog when installing later', async () => {
      const offline = await signup('Offline');
      await call('/friendships', 'POST', { toId: offline.user.id }, actor.token);
      assert.equal(await prisma.notification.count({ where: { recipientId: offline.user.id } }), 1);
      assert.equal(await prisma.pushDelivery.count({ where: { userId: offline.user.id } }), 0);
      await register(offline); await tick(); assert.equal(messages.length, 8);
    });
    await t.test('Account switching and expired messages never deliver to another account or after 24 hours', async () => {
      const next = await signup('Switch');
      await call(`/reviews/${review.id}/like`, 'POST', {}, next.token);
      // Bind both installations to the actor before the worker claims the event.
      await call('/push/devices', 'PUT', android, actor.token);
      await call('/push/devices', 'PUT', ios, actor.token);
      await tick(); assert.equal(messages.length, 8);
      await register(owner);
      const expired = await signup('Expired');
      await call('/friendships', 'POST', { toId: owner.user.id }, expired.token);
      await prisma.notification.updateMany({ where: { actorId: expired.user.id }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
      await tick(); assert.equal(messages.length, 8);
    });
    await t.test('A queue write failure rolls back both the friend request and notification', async () => {
      const next = await signup('Rollback');
      await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_social_push BEFORE INSERT ON PushDelivery WHEN NEW.kind = 'social-notification' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`);
      try {
        assert.equal((await call('/friendships', 'POST', { toId: owner.user.id }, next.token)).status, 500);
        assert.equal(await prisma.friendship.count({ where: { requesterId: next.user.id } }), 0);
        assert.equal(await prisma.notification.count({ where: { actorId: next.user.id } }), 0);
      } finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_social_push'); }
    });
  } finally { await close(api); await close(provider); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
