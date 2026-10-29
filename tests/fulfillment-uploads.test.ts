import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
test('Persistent images, ownership, one-time rewards, refunds and consistent backups', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-assets-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`; await writeFile(path.join(dir, 'test.db'), '');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads'); process.env.BACKUP_DIR = path.join(dir, 'backups');
  process.env.JWT_SECRET = 'test-only-assets-123456789'; process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/prisma'); const { createApp } = await import('../src/index');
  const server = createApp().listen(); await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  async function call(route: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(origin + '/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  async function signup(email: string) { return (await call('/auth/register', 'POST', { name: email, email, password: 'Testing1234' })).data; }
  try {
    const alice = await signup('alice@assets.test'), staff = await signup('staff@assets.test'), admin = await signup('admin@assets.test');
    await prisma.user.update({ where: { id: staff.user.id }, data: { role: 'moderator' } });
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'superadmin' } });
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#abcdef' } }).png().toBuffer();
    const image = `data:image/png;base64,${bytes.toString('base64')}`;
    assert.equal((await call('/uploads', 'POST', { image })).status, 401);
    assert.equal((await call('/uploads', 'POST', { image: 'data:image/png;base64,AAAA' }, alice.token)).status, 400);
    const uploaded = await call('/uploads', 'POST', { image }, alice.token);
    assert.equal(uploaded.status, 201); assert.match(uploaded.data.url, /^\/media\/.*\.webp$/);
    const served = await fetch(origin + uploaded.data.url);
    assert.equal(served.status, 200); assert.equal(served.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).format, 'webp');
    const movie = await call('/movies', 'POST', { title: 'Uploaded poster', overview: 'A movie', genres: ['Drama'], runtime: 90, releaseDate: '2026-01-01', posterUrl: image }, admin.token);
    assert.equal(movie.status, 201); assert.match(movie.data.posterUrl, /^\/media\//);
    const review = await call(`/movies/${movie.data.id}/reviews`, 'POST', { text: 'Photo review', rating: 4, photo: origin + uploaded.data.url }, alice.token);
    assert.equal(review.status, 201); assert.equal(review.data.photo, uploaded.data.url);
    assert.equal((await call(`/movies/${movie.data.id}/reviews`, 'POST', { text: 'Stolen photo', rating: 4, photo: uploaded.data.url }, staff.token)).status, 403);
    assert.ok(!(await prisma.review.findFirstOrThrow()).photo?.startsWith('data:'));
    for (let i = 0; i < 4; i++) {
      const extra = await prisma.movie.create({ data: { title: `Extra ${i}`, overview: '' } });
      await prisma.review.create({ data: { authorId: alice.user.id, movieId: extra.id, text: 'Another review', rating: 4 } });
    }
    const redeemed = await call('/rewards/redeem', 'POST', { rewardId: 'popcorn' }, alice.token);
    assert.equal(redeemed.status, 201);
    const code = redeemed.data.code;
    assert.equal((await call('/admin/redemptions/validate', 'POST', { code }, alice.token)).status, 403);
    assert.equal((await call('/admin/redemptions/validate', 'POST', { code }, staff.token)).data.status, 'active');
    const uses = await Promise.all([call('/admin/redemptions/use', 'POST', { code }, staff.token), call('/admin/redemptions/use', 'POST', { code }, staff.token)]);
    assert.deepEqual(uses.map(r => r.status).sort(), [200, 409]);
    const used = await prisma.redemption.findUniqueOrThrow({ where: { code } });
    assert.equal(used.usedById, staff.user.id);
    assert.equal((await call(`/admin/redemptions/${used.id}/refund`, 'POST', {}, admin.token)).status, 409);
    const next = await call('/rewards/redeem', 'POST', { rewardId: 'popcorn' }, alice.token);
    assert.equal(next.status, 201);
    const expired = await prisma.redemption.update({ where: { code: next.data.code }, data: { expiresAt: new Date(0) } });
    assert.equal((await call('/admin/redemptions/validate', 'POST', { code: expired.code }, staff.token)).data.status, 'expired');
    assert.equal((await call('/admin/redemptions/use', 'POST', { code: expired.code }, staff.token)).status, 409);
    assert.equal((await call(`/admin/redemptions/${expired.id}/refund`, 'POST', {}, staff.token)).status, 403);
    assert.equal((await call(`/admin/redemptions/${expired.id}/refund`, 'POST', {}, admin.token)).status, 200);
    assert.equal((await call(`/admin/redemptions/${expired.id}/refund`, 'POST', {}, admin.token)).status, 409);
    assert.equal((await call('/rewards', 'GET', undefined, alice.token)).data.spentPoints, 30);
    const { backupDatabase } = await import('../scripts/backup-db');
    const backup = await backupDatabase();
    assert.ok((await stat(path.join(backup, 'whatnext.db'))).size > 0);
    const filename = uploaded.data.url.split('/').pop();
    assert.ok((await stat(path.join(backup, 'uploads', filename))).size > 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true });
  }
});
