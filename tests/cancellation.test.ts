import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Owner cancellation invalidates vouchers and refunds only the verified original debit', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-cancel-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`; await writeFile(path.join(dir, 'test.db'), '');
  process.env.JWT_SECRET = 'cancellation-test-only-secret-123456'; process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/prisma'); const { createApp } = await import('../src/index');
  const { getAchievements } = await import('../src/services/gamification');
  const { cancelRedemption } = await import('../src/services/fulfillment');
  const server = createApp().listen(); await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function call(route: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const movies = await prisma.movie.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ title: `Cancel movie ${i}`, overview: '' })) });
  assert.equal(movies.count, 5);
  const movieRows = await prisma.movie.findMany({ select: { id: true } });
  let sequence = 0;
  async function user(funded = true) {
    const result = await call('/auth/register', 'POST', { name: 'Cancel Tester', email: `cancel${++sequence}@fixture.test`, password: 'Testing1234' });
    assert.equal(result.status, 201);
    const account = result.data;
    if (funded) {
      await prisma.review.createMany({ data: movieRows.map(movie => ({ movieId: movie.id, authorId: account.user.id, text: 'Test review', rating: 4 })) });
      await getAchievements(account.user.id);
    }
    return account;
  }
  async function buy(account: any) {
    const result = await call('/rewards/redeem', 'POST', { rewardId: 'popcorn' }, account.token);
    assert.equal(result.status, 201); return result.data;
  }
  async function balance(account: any) { return (await call('/points', 'GET', undefined, account.token)).data.balance; }
  try {
    const admin = await user(false); await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'superadmin' } });
    await t.test('Only the owner can cancel; retries and parallel requests return a single credit', async () => {
      const owner = await user(), other = await user(false), voucher = await buy(owner);
      const route = `/rewards/redemptions/${voucher.redemptionId}`;
      assert.equal(await balance(owner), 15);
      assert.equal((await call(route, 'DELETE')).status, 401);
      assert.equal((await call(route, 'DELETE', undefined, other.token)).status, 404);
      assert.equal((await call('/rewards/redemptions/invalid', 'DELETE', undefined, owner.token)).status, 400);
      assert.equal((await call('/rewards/redemptions/999999', 'DELETE', undefined, owner.token)).status, 404);
      const attempts = await Promise.all(Array.from({ length: 3 }, () => call(route, 'DELETE', { cost: 1000000, userId: other.user.id }, owner.token)));
      assert.ok(attempts.every(result => result.status === 200));
      assert.equal(attempts.filter(result => !result.data.alreadyCanceled).length, 1);
      assert.equal(await balance(owner), 45); assert.equal(await balance(other), 0);
      const row = await prisma.redemption.findUniqueOrThrow({ where: { id: voucher.redemptionId } });
      assert.equal(row.status, 'canceled'); assert.equal(row.refundedById, owner.user.id); assert.ok(row.refundedAt);
      const credits = await prisma.pointEntry.findMany({ where: { userId: owner.user.id, key: `refund:${row.id}` } });
      assert.equal(credits.length, 1); assert.equal(credits[0].amount, 30);
      const rewards = (await call('/rewards', 'GET', undefined, owner.token)).data;
      assert.equal(rewards.spentPoints, 0); assert.equal(rewards.availablePoints, 45);
      assert.ok(!rewards.redeemed.some((item: any) => item.id === row.id));
      assert.equal((await call('/admin/redemptions/validate', 'POST', { code: row.code }, admin.token)).data.status, 'canceled');
      assert.equal((await call('/admin/redemptions/use', 'POST', { code: row.code }, admin.token)).status, 409);
      assert.equal((await call(`/admin/redemptions/${row.id}/refund`, 'POST', {}, admin.token)).status, 409);
      assert.equal((await call(`/rewards/redemptions/${row.id}/wallet`, 'POST', { provider: 'apple' }, owner.token)).status, 409);
      assert.equal((await call(`/rewards/redemptions/${row.id}/wallet`, 'POST', { provider: 'google' }, owner.token)).status, 409);
    });
    await t.test('A used voucher cannot be canceled or credited', async () => {
      const owner = await user(), voucher = await buy(owner);
      assert.equal((await call('/admin/redemptions/use', 'POST', { code: voucher.code }, admin.token)).status, 200);
      assert.equal((await call(`/rewards/redemptions/${voucher.redemptionId}`, 'DELETE', undefined, owner.token)).status, 409);
      assert.equal(await balance(owner), 15);
      assert.equal(await prisma.pointEntry.count({ where: { userId: owner.user.id, kind: 'refund' } }), 0);
    });
    await t.test('Simultaneous staff use and owner cancellation have mutually exclusive outcomes', async () => {
      for (let i = 0; i < 3; i++) {
        const owner = await user(), voucher = await buy(owner);
        const actions = [() => call(`/rewards/redemptions/${voucher.redemptionId}`, 'DELETE', undefined, owner.token), () => call('/admin/redemptions/use', 'POST', { code: voucher.code }, admin.token)];
        if (i % 2) actions.reverse();
        const result = await Promise.all(actions.map(action => action()));
        assert.deepEqual(result.map(row => row.status).sort(), [200, 409]);
        const saved = await prisma.redemption.findUniqueOrThrow({ where: { id: voucher.redemptionId } });
        assert.ok(['used', 'canceled'].includes(saved.status));
        assert.equal(await balance(owner), saved.status === 'canceled' ? 45 : 15);
        assert.equal(await prisma.pointEntry.count({ where: { userId: owner.user.id, kind: 'refund' } }), saved.status === 'canceled' ? 1 : 0);
      }
    });
    await t.test('Owner cancellation and an administrator refund cannot both credit the account', async () => {
      const owner = await user(), voucher = await buy(owner);
      const result = await Promise.all([call(`/rewards/redemptions/${voucher.redemptionId}`, 'DELETE', undefined, owner.token), call(`/admin/redemptions/${voucher.redemptionId}/refund`, 'POST', {}, admin.token)]);
      assert.deepEqual(result.map(row => row.status).sort(), [200, 409]);
      assert.equal(await balance(owner), 45);
      assert.equal(await prisma.pointEntry.count({ where: { userId: owner.user.id, kind: 'refund' } }), 1);
    });
    await t.test('Unused expired vouchers can be canceled, but missing or inconsistent debits cannot mint points', async () => {
      const owner = await user(), voucher = await buy(owner);
      await prisma.redemption.update({ where: { id: voucher.redemptionId }, data: { expiresAt: new Date(0) } });
      assert.equal((await call(`/rewards/redemptions/${voucher.redemptionId}`, 'DELETE', undefined, owner.token)).status, 200);
      assert.equal(await balance(owner), 45);
      const next = await buy(owner);
      const key = { userId_key: { userId: owner.user.id, key: `redemption:${next.redemptionId}` } };
      await prisma.pointEntry.update({ where: key, data: { amount: -1 } });
      const prior = await balance(owner);
      assert.equal((await call(`/rewards/redemptions/${next.redemptionId}`, 'DELETE', undefined, owner.token)).status, 409);
      assert.equal(await balance(owner), prior);
      assert.equal((await prisma.redemption.findUniqueOrThrow({ where: { id: next.redemptionId } })).status, 'active');
      await prisma.pointEntry.delete({ where: key });
      assert.equal((await call(`/rewards/redemptions/${next.redemptionId}`, 'DELETE', undefined, owner.token)).status, 409);
      assert.equal(await prisma.pointEntry.count({ where: { userId: owner.user.id, key: `refund:${next.redemptionId}` } }), 0);
    });
    await t.test('A failed credit insert rolls back voucher invalidation and allows a clean retry', async () => {
      const owner = await user(), voucher = await buy(owner);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_fixture_refund BEFORE INSERT ON "PointEntry" WHEN NEW."userId" = ${owner.user.id} AND NEW."key" = 'refund:${voucher.redemptionId}' BEGIN SELECT RAISE(ABORT, 'fixture-refund-failure'); END`);
      try { await assert.rejects(cancelRedemption(voucher.redemptionId, owner.user.id)); }
      finally { await prisma.$executeRawUnsafe('DROP TRIGGER fail_fixture_refund'); }
      const row = await prisma.redemption.findUniqueOrThrow({ where: { id: voucher.redemptionId } });
      assert.equal(row.status, 'active'); assert.equal(row.refundedAt, null); assert.equal(await balance(owner), 15);
      assert.equal(await prisma.pointEntry.count({ where: { userId: owner.user.id, kind: 'refund' } }), 0);
      assert.equal((await call(`/rewards/redemptions/${voucher.redemptionId}`, 'DELETE', undefined, owner.token)).status, 200);
      assert.equal(await balance(owner), 45);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true });
  }
});
