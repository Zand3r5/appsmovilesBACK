import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Push conserva las rutas y anuncia que no hay entrega de notificaciones', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-push-minimal-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  process.env.JWT_SECRET = 'push-minimal-test-secret-123456789';
  await writeFile(path.join(dir, 'test.db'), '');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/prisma');
  const { createApp } = await import('../src/index');
  const server = createApp().listen(); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function call(route: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  try {
    assert.equal((await call('/push/status')).status, 401);
    const account = (await call('/auth/register', 'POST', { name: 'Push', email: 'push@test.local', password: 'Testing1234' })).data;
    const registered = await call('/push/devices', 'PUT', { id: 'installation', platform: 'android' }, account.token);
    assert.equal(registered.status, 200); assert.equal(registered.data.enabled, false);
    assert.deepEqual((await call('/push/status', 'GET', undefined, account.token)).data, { devices: [], deliveries: [] });
    assert.equal((await call('/push/test', 'POST', {}, account.token)).data.accepted, 0);
    assert.equal((await call('/push/devices/installation', 'DELETE', {}, account.token)).status, 204);
    assert.equal((await call('/wallet/status', 'GET', undefined, account.token)).data.apple.available, false);
    assert.equal((await call('/wallet/apple/1.pkpass')).status, 503);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
