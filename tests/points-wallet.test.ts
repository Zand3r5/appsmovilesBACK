import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createHash, createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { unzipSync } from 'fflate';

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
      assert.equal(await prisma.pointEntry.count({ where: { userId: alice.user.id, key: `refund:${id}` } }), 1);
      assert.equal((await call('/points?before=invalid', 'GET', undefined, alice.token)).status, 400);
    });
    await t.test('Existing redemptions and refunds migrate once without inventing historical awards', async () => {
      const legacy = await signup('legacy@wallet.test');
      await prisma.review.create({ data: { movieId: movie.id, authorId: legacy.user.id, text: 'Legacy', rating: 3 } });
      await prisma.redemption.create({ data: { userId: legacy.user.id, rewardId: 'popcorn', cost: 30, code: 'A'.repeat(16), status: 'refunded', refundedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });
      const first = await call('/points', 'GET', undefined, legacy.token);
      assert.equal(first.data.balance, 10); assert.equal(first.data.entries.length, 3);
      await call('/points', 'GET', undefined, legacy.token);
      assert.equal(await prisma.pointEntry.count({ where: { userId: legacy.user.id } }), 3);
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
    await t.test('Google Wallet signs a stable generic voucher object with the existing code', async () => {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const credentials = path.join(dir, 'google.json');
      await writeFile(credentials, JSON.stringify({ client_email: 'wallet@fixture.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
      process.env.WALLET_GOOGLE_CREDENTIALS_PATH = credentials; process.env.WALLET_GOOGLE_ISSUER_ID = '123456'; process.env.WALLET_GOOGLE_CLASS_ID = '123456.whatnext';
      const one = await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'google' }, alice.token);
      assert.equal(one.status, 200); assert.ok(one.data.url.startsWith('https://pay.google.com/gp/v/save/'));
      const claims = jwt.verify(one.data.url.split('/save/')[1], publicKey, { algorithms: ['RS256'], audience: 'google' }) as any;
      assert.equal(claims.typ, 'savetowallet'); assert.equal(claims.iss, 'wallet@fixture.test');
      const object = claims.payload.genericObjects[0];
      assert.equal(object.barcode.value, redeemed.data.code); assert.equal(object.classId, '123456.whatnext');
      const two = await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'google' }, alice.token);
      assert.equal((jwt.decode(two.data.url.split('/save/')[1]) as any).payload.genericObjects[0].id, object.id);
      assert.equal(await prisma.redemption.count({ where: { id } }), 1);
    });
    await t.test('Apple pass package has a valid detached signature and short-lived session-bound download', async () => {
      const openssl = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
      openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=Fixture CA']);
      openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'pass.key', '-out', 'pass.csr', '-subj', '/CN=pass.test.whatnext/OU=TESTTEAM']);
      openssl(['x509', '-req', '-in', 'pass.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'pass.pem', '-days', '1']);
      process.env.WALLET_APPLE_CERT_PATH = path.join(dir, 'pass.pem'); process.env.WALLET_APPLE_KEY_PATH = path.join(dir, 'pass.key'); process.env.WALLET_APPLE_WWDR_PATH = path.join(dir, 'ca.pem');
      process.env.WALLET_APPLE_PASS_TYPE_ID = 'pass.test.whatnext'; process.env.WALLET_APPLE_TEAM_ID = 'TESTTEAM'; process.env.WALLET_PUBLIC_BASE_URL = origin;
      const link = await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'apple' }, alice.token);
      assert.equal(link.status, 200);
      const response = await fetch(link.data.url);
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/vnd.apple.pkpass');
      assert.match(response.headers.get('cache-control')!, /no-store/);
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const pass = JSON.parse(Buffer.from(files['pass.json']).toString());
      assert.equal(pass.serialNumber, `whatnext-${id}`); assert.equal(pass.barcodes[0].message, redeemed.data.code); assert.ok(pass.coupon);
      const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
      for (const [name, digest] of Object.entries(manifest)) assert.equal(createHash('sha1').update(files[name]).digest('hex'), digest);
      await writeFile(path.join(dir, 'signature'), files.signature); await writeFile(path.join(dir, 'manifest.json'), files['manifest.json']);
      openssl(['smime', '-verify', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-noverify', '-out', 'verified']);
      const url = new URL(link.data.url), ticket = url.searchParams.get('ticket')!;
      assert.equal((await fetch(`${origin}/api/wallet/apple/${id + 1}.pkpass?ticket=${ticket}`)).status, 401);
      const expired = jwt.sign({ sub: String(alice.user.id), redemptionId: id, sid: (jwt.decode(ticket) as any).sid }, createHmac('sha256', process.env.JWT_SECRET!).update('whatnext.apple-download.v1').digest(), { algorithm: 'HS256', expiresIn: -1, audience: 'apple-pass', issuer: 'whatnext-wallet' });
      assert.equal((await fetch(`${origin}/api/wallet/apple/${id}.pkpass?ticket=${expired}`)).status, 401);
      // Download tickets cannot be used as API login tokens.
      assert.equal((await call('/auth/me', 'GET', undefined, ticket)).status, 401);
      const session = await call('/auth/login', 'POST', { email: 'alice@wallet.test', password: 'Testing1234' });
      const otherLink = await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'apple' }, session.data.token);
      await call('/auth/logout', 'POST', undefined, session.data.token);
      assert.equal((await fetch(otherLink.data.url)).status, 401);
      await call('/admin/redemptions/use', 'POST', { code: redeemed.data.code }, admin.token);
      assert.equal((await fetch(link.data.url)).status, 409);
      assert.equal((await call(`/rewards/redemptions/${id}/wallet`, 'POST', { provider: 'google' }, alice.token)).status, 409);
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
