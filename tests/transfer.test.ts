import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

// Exercise the actual previous migration chain, not a hand-built approximation.
test('Upgrade preserves existing accounts, balances, vouchers, reference definitions and uploaded images', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-transfer-'));
  const root = process.cwd();
  const bundled = process.env.TRANSFER_SOURCE === 'bundled';
  const cli = path.resolve('node_modules/prisma/build/index.js');
  const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  process.env.JWT_SECRET = 'transfer-test-only-secret-with-32-characters';
  process.env.NODE_ENV = 'test';
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.BACKUP_DIR = path.join(dir, 'backups');
  const oldProject = path.join(dir, 'old');
  await mkdir(path.join(oldProject, 'prisma/migrations'), { recursive: true });
  await cp('tests/fixtures/simple-schema.prisma', path.join(oldProject, 'prisma/schema.prisma'));
  for (const entry of await readdir('prisma/migrations')) {
    if ((entry !== 'migration_lock.toml' && entry > '202610280003_simple_backend') || (bundled && ['202610280002_reference_catalog', '202610280003_simple_backend'].includes(entry))) continue;
    await cp(path.join('prisma/migrations', entry), path.join(oldProject, 'prisma/migrations', entry), { recursive: true });
  }
  const run = (args: string[], cwd = root) => execFileSync(process.execPath, [cli, ...args], { cwd, env: process.env, stdio: 'pipe' });
  try {
    await writeFile(path.join(dir, 'test.db'), '');
    run(['migrate', 'deploy'], oldProject);
    const fixture = path.join(dir, 'fixture.sql');
    let fixtureSql = `
      INSERT INTO User(id,name,email,passwordHash,points) VALUES (101,'Existing','existing@transfer.test','unused',17),(102,'Adjustment','adjustment@transfer.test','unused',-5);
      UPDATE Reward SET title='Custom popcorn',cost=31 WHERE id='popcorn';
      INSERT INTO AchievementAward(userId,achievementId,points) VALUES (101,'first_review',10),(101,'cinema_photo',20);
      INSERT INTO PointEntry(id,userId,kind,amount,description) VALUES (901,101,'achievement',10,'Original award'),(902,101,'redemption',-30,'Original purchase');
      INSERT INTO Redemption(id,userId,rewardId,cost,code,status,expiresAt) VALUES (501,101,'popcorn',30,'AAAAAAAAAAAAAAAA','active','2099-01-01T00:00:00.000Z'),(502,101,'popcorn',30,'BBBBBBBBBBBBBBBB','canceled','2099-01-01T00:00:00.000Z');
      UPDATE Redemption SET refundedAt=CURRENT_TIMESTAMP WHERE id=502;
      INSERT INTO Movie(id,title,overview) VALUES (701,'Existing movie','Saved overview');
      INSERT INTO Review(id,text,photo,authorId,movieId) VALUES (801,'Existing review','/media/00000000-0000-4000-8000-000000000001.png',101,701);
    `;
    if (bundled) {
      fixtureSql = fixtureSql.replace("INSERT INTO User(id,name,email,passwordHash,points) VALUES (101,'Existing','existing@transfer.test','unused',17),(102,'Adjustment','adjustment@transfer.test','unused',-5);", "INSERT INTO User(id,name,email,passwordHash) VALUES (101,'Existing','existing@transfer.test','unused'),(102,'Adjustment','adjustment@transfer.test','unused');");
      // Reference tables do not exist in the original bundled schema yet.
      fixtureSql = fixtureSql.replace("UPDATE Reward SET title='Custom popcorn',cost=31 WHERE id='popcorn';", '');
      fixtureSql = fixtureSql.replace("INSERT INTO PointEntry(id,userId,kind,amount,description) VALUES (901,101,'achievement',10,'Original award'),(902,101,'redemption',-30,'Original purchase');", `INSERT INTO PointEntry(id,userId,key,kind,amount,description) VALUES
        (901,101,'achievement:first_review','achievement',10,'Original award'),
        (902,101,'redemption:501','redemption',-30,'Original purchase'),
        (903,101,'achievement:cinema_photo','achievement',20,'Original photo award'),
        (904,101,'adjustment:manual','adjustment',17,'Original adjustment'),
        (905,102,'adjustment:negative','adjustment',-5,'Original adjustment');`);
    }
    await writeFile(fixture, fixtureSql);
    run(['db', 'execute', '--file', fixture, '--schema', 'prisma/schema.prisma'], oldProject);
    await mkdir(process.env.UPLOAD_DIR, { recursive: true });
    const oldImage = path.join(process.env.UPLOAD_DIR, '00000000-0000-4000-8000-000000000001.png');
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ff0000' } }).png().toFile(oldImage);
    execFileSync(process.execPath, [tsx, 'scripts/setup-db.ts'], { env: process.env, stdio: 'pipe' });
    const { prisma } = await import('../src/prisma');
    try {
      const restored = await prisma.review.findUniqueOrThrow({ where: { id: 801 } });
      const { imageReference } = await import('../src/services/uploads');
      assert.equal(await imageReference(restored.photo, 101), restored.photo);
      const { pointsSummary } = await import('../src/services/points');
      assert.equal((await pointsSummary(prisma, 101)).balance, 17);
      assert.equal((await pointsSummary(prisma, 102)).balance, -5);
      assert.equal((await pointsSummary(prisma, 101)).earned, 30);
      assert.equal((await pointsSummary(prisma, 101)).spent, 30);
      assert.equal(await prisma.user.count(), 2);
      assert.equal((await prisma.pointEntry.findUniqueOrThrow({ where: { id: 901 } })).amount, 10);
      assert.equal((await prisma.pointEntry.findUniqueOrThrow({ where: { id: 901 } })).kind, 'legacy:achievement');
      assert.equal((await prisma.reward.findUniqueOrThrow({ where: { id: 'popcorn' } })).cost, bundled ? 30 : 31);
      const { cancelRedemption } = await import('../src/services/fulfillment');
      assert.equal((await cancelRedemption(501, 101)).alreadyCanceled, false);
      assert.equal((await pointsSummary(prisma, 101)).balance, 47);
      assert.equal((await cancelRedemption(501, 101)).alreadyCanceled, true);
      assert.equal((await cancelRedemption(502, 101)).alreadyCanceled, true);
      assert.equal((await pointsSummary(prisma, 101)).balance, 47);
      assert.equal(await prisma.pointEntry.count({ where: { userId: 101, key: 'refund:501' } }), 1);
      const before = await prisma.pointEntry.count();
      run(['migrate', 'deploy']);
      assert.equal(await prisma.pointEntry.count(), before);
      execFileSync(process.execPath, [tsx, 'scripts/migrate-images.ts'], { env: process.env, stdio: 'pipe' });
      const review = await prisma.review.findUniqueOrThrow({ where: { id: 801 } });
      assert.match(review.photo!, /^\/media\/[0-9a-f-]+\.webp$/);
      const upload = await prisma.upload.findUniqueOrThrow({ where: { filename: review.photo!.split('/').pop() } });
      assert.equal(upload.ownerId, 101);
      assert.equal((await sharp(await readFile(path.join(process.env.UPLOAD_DIR!, upload.filename))).metadata()).format, 'webp');
      assert.ok((await readFile(oldImage)).length > 0);
      execFileSync(process.execPath, [tsx, 'scripts/migrate-images.ts'], { env: process.env, stdio: 'pipe' });
      assert.equal(await prisma.upload.count(), 1);
      assert.equal((await prisma.review.findUniqueOrThrow({ where: { id: 801 } })).photo, review.photo);
    } finally { await prisma.$disconnect(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
  if (!bundled) {
    // Rehearse the original frontend backend's seven-migration history too.
    execFileSync(process.execPath, [tsx, '--test', 'tests/transfer.test.ts'], {
      env: { ...process.env, TRANSFER_SOURCE: 'bundled' }, stdio: 'pipe',
    });
  }
});
