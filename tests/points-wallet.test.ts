import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Permanent points ledger, migration and signed reward vouchers', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-wallet-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  await writeFile(path.join(dir, 'test.db'), '');
  process.env.JWT_SECRET = 'wallet-test-only-secret-with-32-characters'; process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) if (key.startsWith('WALLET_')) delete process.env[key];
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/prisma'); const { createApp } = await import('../src/index');
  const { getAchievements } = await import('../src/services/gamification');
  const server = createApp().listen(); await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  async function call(route: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(origin + '/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  async function signup(email: string) { return (await call('/auth/register', 'POST', { name: 'Voucher User', email, password: 'Testing1234' })).data; }
  try {
    const alice = await signup('alice@wallet.test'), bob = await signup('bob@wallet.test'), admin = await signup('admin@wallet.test');
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'superadmin' } });
    const movie = await prisma.movie.create({ data: { title: 'Ledger movie', overview: '' } });
    await t.test('Awards are atomic, permanent and never repeat after deleting and recreating a review', async () => {
      assert.equal((await call('/points')).status, 401);
      const review = await call(`/movies/${movie.id}/reviews`, 'POST', { text: 'First review', rating: 4 }, alice.token);
      assert.equal(review.status, 201);
      await Promise.all(Array.from({ length: 4 }, () => getAchievements(alice.user.id)));
      assert.equal((await call('/points', 'GET', undefined, alice.token)).data.balance, 10);
      assert.equal(await prisma.pointEntry.count({ where: { userId: alice.user.id, kind: 'achievement' } }), 1);
      assert.equal((await call(`/reviews/${review.data.id}`, 'DELETE', undefined, alice.token)).status, 204);
      const after = await call('/achievements', 'GET', undefined, alice.token);
      assert.equal(after.data.totalPoints, 10); assert.equal(after.data.list.find((a: any) => a.id === 'first_review').unlocked, true);
      await call(`/movies/${movie.id}/reviews`, 'POST', { text: 'Recreated', rating: 4 }, alice.token);
      assert.equal((await call('/points', 'GET', undefined, alice.token)).data.balance, 10);
      assert.equal((await call('/points', 'GET', undefined, bob.token)).data.entries.length, 0);
    });
    await t.test('Concurrent spending cannot overspend, and refund writes exactly one credit', async () => {
      for (let i = 0; i < 4; i++) {
        const m = await prisma.movie.create({ data: { title: `Earn ${i}`, overview: '' } });
        assert.equal((await call(`/movies/${m.id}/reviews`, 'POST', { text: 'Review', rating: 4 }, alice.token)).status, 201);
      }
      assert.equal((await call('/points', 'GET', undefined, alice.token)).data.balance, 45);
      const attempts = await Promise.all(Array.from({ length: 2 }, () => call('/rewards/redeem', 'POST', { rewardId: 'popcorn' }, alice.token)));
      assert.deepEqual(attempts.map(row => row.status).sort(), [201, 409]);
      const success = attempts.find(row => row.status === 201)!;
      const id = success.data.redemptionId;
      assert.equal((await call('/points', 'GET', undefined, alice.token)).data.balance, 15);
      const refunds = await Promise.all(Array.from({ length: 2 }, () => call(`/admin/redemptions/${id}/refund`, 'POST', {}, admin.token)));
      assert.deepEqual(refunds.map(row => row.status).sort(), [200, 409]);
      assert.equal((await call('/points', 'GET', undefined, alice.token)).data.balance, 45);
      assert.equal(await prisma.pointEntry.count({ where: { userId: alice.user.id, kind: 'refund' } }), 1);
      assert.equal((await call('/points?before=invalid', 'GET', undefined, alice.token)).status, 400);
    });
    await t.test('GET de puntos y logros no escriben ni modifican el saldo', async () => {
      const before = await prisma.pointEntry.count();
      const awards = await prisma.achievementAward.count();
      const user = await prisma.user.findUniqueOrThrow({ where: { id: alice.user.id } });
      for (const route of ['/points','/achievements','/rewards']) assert.equal((await call(route, 'GET', undefined, alice.token)).status, 200);
      assert.equal(await prisma.pointEntry.count(), before);
      assert.equal(await prisma.achievementAward.count(), awards);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).points, user.points);
    });
    const redeemed = await call('/rewards/redeem', 'POST', { rewardId: 'popcorn' }, alice.token);
    const id = redeemed.data.redemptionId;
    await t.test('Wallet exports require ownership, a usable voucher and configured providers', async () => {
      assert.equal((await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'google' })).status, 401);
      assert.equal((await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'google' }, bob.token)).status, 404);
      assert.equal((await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'other' }, alice.token)).status, 400);
      assert.equal((await call('/wallet/status', 'GET', undefined, alice.token)).data.apple.available, false);
      assert.equal((await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'apple' }, alice.token)).status, 503);
      assert.equal((await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'google' }, alice.token)).status, 503);
    });
    await t.test('Expired and refunded codes cannot be exported', async () => {
      const unused = await prisma.redemption.create({ data: { userId: alice.user.id, rewardId: 'popcorn', cost: 30, code: 'B'.repeat(16), expiresAt: new Date(0) } });
      assert.equal((await call(`/rewards/redemptions/${unused.id}/wallet`, 'POST', { provider: 'google' }, alice.token)).status, 409);
      await prisma.redemption.update({ where: { id: unused.id }, data: { expiresAt: new Date(Date.now() + 86400000), status: 'refunded', refundedAt: new Date() } });
      assert.equal((await call(`/rewards/redemptions/${unused.id}/wallet`, 'POST', { provider: 'google' }, alice.token)).status, 409);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true });
  }
});
