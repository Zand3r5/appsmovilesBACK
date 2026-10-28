import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Setup y seed idempotente conservan usuarios; premios, logros y rangos salen de consultas', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-reference-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/setup-db.ts'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/prisma');
  const { seedReferenceData } = await import('../prisma/reference');
  try {
    const user = await prisma.user.create({ data: { name: 'Reference', email: 'reference@test.local', passwordHash: 'unused' } });
    await seedReferenceData(); await seedReferenceData();
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.reward.count(), 4);
    assert.equal(await prisma.achievement.count(), 7);
    assert.equal(await prisma.rank.count(), 4);
    await prisma.reward.update({ where: { id: 'popcorn' }, data: { title: 'Título desde SQLite', cost: 31 } });
    const { getRewards, getAchievements } = await import('../src/services/gamification');
    const rewards = await getRewards(user.id);
    assert.equal(rewards.catalog.find(row => row.id === 'popcorn')?.title, 'Título desde SQLite');
    await prisma.achievement.update({ where: { id: 'first_review' }, data: { title: 'Logro desde SQLite' } });
    assert.ok((await getAchievements(user.id)).list.some(row => row.title === 'Logro desde SQLite'));
    await prisma.rank.update({ where: { min: 5 }, data: { name: 'Rango desde SQLite' } });
    const { calculateRank } = await import('../src/services/ranks');
    assert.equal((await calculateRank(5)).current?.name, 'Rango desde SQLite');
  } finally { await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
