import jwt from 'jsonwebtoken';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test('Database API, credential-checked sessions, permissions, rewards and scheduled catalog snapshots', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-api-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  await writeFile(path.join(dir, 'test.db'), '');
  process.env.JWT_SECRET = 'integration-test-secret-only-123456789';
  process.env.NODE_ENV = 'test';
  process.env.TMDB_KEY = 'fixture';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  let tmdbRequests = 0, failTmdb = false;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const past = '2026-01-01';
  const fakeTmdb = createServer((req, res) => {
    tmdbRequests++;
    const url = new URL(req.url!, 'http://fixture');
    res.setHeader('Content-Type', 'application/json');
    if (failTmdb) { res.statusCode = 401; return res.end('{}'); }
    const detail = url.pathname.match(/^\/movie\/(\d+)$/);
    if (detail) {
      const id = Number(detail[1]);
      return res.end(JSON.stringify({ id, title: `Movie ${id}`, overview: 'Test movie', release_date: id === 103 ? tomorrow : past,
        runtime: 120, poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg', genres: [{ id: 18, name: 'Drama' }], credits: { cast: [], crew: [] }, videos: { results: [] },
        'watch/providers': { results: {} }, release_dates: { results: [] } }));
    }
    const ids = url.pathname === '/movie/popular' ? [101, 102] : url.pathname === '/movie/now_playing' ? [102] : [103];
    res.end(JSON.stringify({ total_pages: 1, results: ids.map(id => ({ id, vote_average: 8, release_date: id === 103 ? tomorrow : past })) }));
  });
  process.env.TMDB_BASE_URL = await listen(fakeTmdb);
  let overpassRequests = 0, overpassFailed = false;
  const fakeOverpass = createServer((_req, res) => {
    overpassRequests++;
    res.setHeader('Content-Type', 'application/json');
    if (overpassFailed) { res.statusCode = 503; return res.end('{}'); }
    res.end(JSON.stringify({ elements: [
      { type: 'way', id: 2, center: { lat: 0.02, lon: 0 }, tags: { name: 'Farther Cinema', 'addr:street': 'Test Street', 'addr:housenumber': '20' } },
      { type: 'node', id: 1, lat: 0.01, lon: 0, tags: { name: 'Nearest Cinema' } },
      { type: 'node', id: 1, lat: 0.01, lon: 0, tags: { name: 'Nearest Cinema' } },
      { type: 'node', id: 3, lat: 1, lon: 0, tags: { name: 'Outside radius' } },
      { type: 'way', id: 4, tags: { name: 'Missing location' } },
    ] }));
  });
  process.env.OVERPASS_URL = await listen(fakeOverpass);
  const { createApp } = await import('../src/index');
  const { prisma } = await import('../src/prisma');
  const { syncCatalog } = await import('../src/services/tmdb');
  const server = createApp().listen();
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function call(route: string, method = 'GET', body?: any, token?: string) {
    const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data };
  }
  async function signup(email: string) {
    const registered = await call('/auth/register', 'POST', { name: email.split('@')[0], email, password: 'Testing1234' });
    assert.equal(registered.status, 201);
    assert.ok(registered.data.token);
    return registered.data;
  }
  try {
    await t.test('Signup immediately authenticates; credentials, session expiry and logout are checked', async () => {
      assert.equal((await call('/auth/register', 'POST', { name: 'X', email: 'bad', password: '123' })).status, 400);
      const email = 'newuser@example.test';
      const registered = await call('/auth/register', 'POST', { name: 'New user', email, password: 'Testing1234', role: 'superadmin' });
      assert.equal(registered.status, 201);
      assert.ok(registered.data.token);
      assert.equal(registered.data.verificationRequired, undefined);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(user.role, 'user');
      assert.notEqual(user.passwordHash, 'Testing1234');
      assert.equal((await call('/auth/register', 'POST', { name: 'Duplicate', email, password: 'Testing1234' })).status, 409);
      const token = registered.data.token;
      assert.equal((await call('/auth/me', 'GET', undefined, token)).data.email, email);
      assert.equal((await call('/auth/logout', 'POST', undefined, token)).status, 204);
      assert.equal((await call('/auth/me', 'GET', undefined, token)).status, 200);
      assert.equal((await call('/auth/login', 'POST', { email, password: 'wrong' })).status, 401);
      const login = await call('/auth/login', 'POST', { email, password: 'Testing1234' });
      assert.equal(login.status, 200);
      const expiredToken = jwt.sign({ sub: String(user.id) }, process.env.JWT_SECRET!, { expiresIn: -1 });
      assert.equal((await call('/auth/me', 'GET', undefined, expiredToken)).status, 401);
      assert.equal((await call('/auth/me', 'GET', undefined, 'invalid-token')).status, 401);
      assert.equal((await call('/auth/verify', 'POST', { email, code: '000000' })).status, 404);
    });
    const alice = await signup('alice@example.test'), bob = await signup('bob@example.test'), charlie = await signup('charlie@example.test');
    await t.test('Only the sync job contacts TMDB and the API serves persisted release snapshots', async () => {
      assert.deepEqual((await call('/releases/upcoming')).data, []);
      assert.equal(tmdbRequests, 0);
      await syncCatalog();
      const before = tmdbRequests;
      const upcoming = await call('/releases/upcoming'), now = await call('/releases/now-playing');
      assert.equal(upcoming.data[0].tmdbId, 103);
      assert.equal(now.data[0].tmdbId, 102);
      assert.equal(now.data[0].rating, 4);
      for (const route of ['/movies', `/movies/${now.data[0].id}`, `/movies/${now.data[0].id}/recommendations`, '/movies/search?q=Movie']) assert.equal((await call(route)).status, 200);
      assert.equal((await call('/movies/999999')).status, 404);
      assert.equal(tmdbRequests, before);
      failTmdb = true;
      await assert.rejects(syncCatalog());
      assert.deepEqual((await call('/releases/upcoming')).data, upcoming.data);
      failTmdb = false;
    });
    await t.test('Release subscriptions persist per account and follow current release dates', async () => {
      const upcoming = await prisma.movie.findUniqueOrThrow({ where: { tmdbId: 103 } });
      assert.equal((await call('/reminders')).status, 401);
      assert.equal((await call(`/reminders/${upcoming.id}`, 'PUT')).status, 401);
      const subscribed = await call(`/reminders/${upcoming.id}`, 'PUT', { userId: bob.user.id }, alice.token);
      assert.equal(subscribed.status, 200);
      assert.equal(subscribed.data.remindAt, `${tomorrow}T13:00:00.000Z`);
      assert.equal((await call(`/reminders/${upcoming.id}`, 'PUT', {}, alice.token)).status, 200);
      assert.equal(await prisma.releaseReminder.count(), 1);
      assert.deepEqual((await call('/reminders', 'GET', undefined, bob.token)).data, []);
      const anotherDevice = await call('/auth/login', 'POST', { email: 'alice@example.test', password: 'Testing1234' });
      assert.equal((await call('/reminders', 'GET', undefined, anotherDevice.data.token)).data[0].movieId, upcoming.id);
      const changedDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      await prisma.movie.update({ where: { id: upcoming.id }, data: { releaseDate: changedDate } });
      assert.equal((await call('/reminders', 'GET', undefined, alice.token)).data[0].remindAt, `${changedDate}T13:00:00.000Z`);
      assert.equal((await call(`/reminders/${upcoming.id}`, 'DELETE', undefined, bob.token)).status, 204);
      assert.equal((await call('/reminders', 'GET', undefined, alice.token)).data.length, 1);
      await prisma.movie.update({ where: { id: upcoming.id }, data: { hidden: true } });
      assert.deepEqual((await call('/reminders', 'GET', undefined, alice.token)).data, []);
      assert.equal((await call(`/reminders/${upcoming.id}`, 'PUT', {}, alice.token)).status, 404);
      await prisma.movie.update({ where: { id: upcoming.id }, data: { hidden: false, releaseDate: '2000-01-01' } });
      assert.equal((await call('/reminders', 'GET', undefined, alice.token)).data[0].remindAt, null);
      assert.equal((await call(`/reminders/${upcoming.id}`, 'PUT', {}, alice.token)).status, 409);
      assert.equal((await call('/reminders/999999', 'PUT', {}, alice.token)).status, 404);
      assert.equal((await call('/reminders/invalid', 'DELETE', undefined, alice.token)).status, 400);
      assert.equal((await call(`/reminders/${upcoming.id}`, 'DELETE', undefined, alice.token)).status, 204);
      assert.equal((await call(`/reminders/${upcoming.id}`, 'DELETE', undefined, alice.token)).status, 204);
      await prisma.movie.update({ where: { id: upcoming.id }, data: { releaseDate: tomorrow } });
      const { releaseReminderTime } = await import('../src/services/reminders');
      const now = new Date('2026-10-26T12:00:00Z');
      assert.equal(releaseReminderTime('2026-10-26', now), '2026-10-26T13:00:00.000Z');
      assert.equal(releaseReminderTime('2026-10-26', new Date('2026-10-26T13:00:00Z')), null);
      assert.equal(releaseReminderTime('2026-02-30', now), null);
      assert.equal(releaseReminderTime(null, now), null);
    });
    await t.test('Cines valida ubicación, elimina duplicados, ordena por distancia y reporta caída del proveedor', async () => {
      const input = { lat: 0, lng: 0, radiusM: 15000 };
      assert.equal((await call('/cinemas/nearby', 'POST', input)).status, 401);
      for (const bad of [{ lat: 91, lng: 0 }, { lat: '0', lng: 0 }, { lat: 0, lng: 181 }, { lat: 0, lng: 0, radiusM: 0 }, { lat: 0, lng: 0, radiusM: 50001 }]) assert.equal((await call('/cinemas/nearby', 'POST', bad, alice.token)).status, 400);
      assert.equal(overpassRequests, 0);
      const first = await call('/cinemas/nearby', 'POST', input, alice.token);
      assert.equal(first.status, 200); assert.equal(first.data.source, 'live');
      assert.deepEqual(first.data.cinemas.map((row: any) => row.id), ['node/1','way/2']);
      assert.ok(first.data.cinemas[0].distanceKm > 1 && first.data.cinemas[0].distanceKm < 1.2);
      assert.equal(first.data.cinemas[1].address, 'Test Street 20');
      const moved = await call('/cinemas/nearby', 'POST', { ...input, lat: 0.004 }, alice.token);
      assert.equal(overpassRequests, 2); assert.equal(moved.data.source, 'live');
      assert.ok(moved.data.cinemas[0].distanceKm < first.data.cinemas[0].distanceKm);
      overpassFailed = true;
      assert.equal((await call('/cinemas/nearby', 'POST', input, alice.token)).status, 503);
      overpassFailed = false;
    });
    const movie = await prisma.movie.findUniqueOrThrow({ where: { tmdbId: 102 } });
    let reviewId: number, requestId: number;
    await t.test('Reviews persist, ownership is enforced and averages run in the backend', async () => {
      assert.equal((await call(`/movies/${movie.id}/reviews`, 'POST', { text: 'Hello', rating: 4 })).status, 401);
      const created = await call(`/movies/${movie.id}/reviews`, 'POST', { text: 'Great', rating: 4, authorId: bob.user.id }, alice.token);
      assert.equal(created.status, 201); reviewId = created.data.id;
      assert.equal(created.data.author.id, alice.user.id);
      assert.equal((await call(`/movies/${movie.id}/reviews`, 'POST', { text: 'Duplicate', rating: 4 }, alice.token)).data.code, 'REVIEW_ALREADY_EXISTS');
      assert.equal((await call(`/reviews/${reviewId}`, 'PATCH', { text: 'Hijack', rating: 1 }, bob.token)).status, 403);
      assert.equal((await call(`/reviews/${reviewId}`, 'DELETE', undefined, bob.token)).status, 403);
      assert.equal((await call(`/reviews/${reviewId}`, 'PATCH', { text: 'Edited', rating: 4.5 }, alice.token)).status, 200);
      assert.equal((await call(`/movies/${movie.id}/reviews`, 'POST', { text: 'Nice', rating: 3.5 }, bob.token)).status, 201);
      const detail = await call(`/movies/${movie.id}`);
      assert.equal(detail.data.communityRating, 4); assert.equal(detail.data.commentsCount, 2); assert.equal(detail.data.reviewsLast30Days, 2);
      // La autora no puede likear ni repostear su propia reseña.
      assert.equal((await call(`/reviews/${reviewId}/like`, 'POST', undefined, alice.token)).status, 403);
      assert.equal((await call(`/reviews/${reviewId}/repost`, 'POST', undefined, alice.token)).status, 403);
      assert.equal((await call(`/reviews/${reviewId}/like`, 'POST', undefined, bob.token)).data.liked, true);
      assert.equal((await call(`/reviews/${reviewId}/repost`, 'POST', undefined, bob.token)).data.reposted, true);
      assert.equal((await call('/notifications', 'GET', undefined, alice.token)).data.length, 2);
      assert.equal((await call(`/users/${bob.user.id}/reposts`)).data.length, 1);
      assert.equal((await call('/auth/me', 'GET', undefined, bob.token)).data.likes[0], reviewId);
    });
    await t.test('Friend requests and notifications enforce recipient permissions', async () => {
      const sent = await call('/friendships', 'POST', { toId: bob.user.id, fromId: charlie.user.id }, alice.token);
      assert.equal(sent.status, 201); requestId = sent.data.id;
      assert.equal((await call(`/friendships/${requestId}`, 'PATCH', { accept: true }, charlie.token)).status, 403);
      assert.equal((await call('/friendships/pending', 'GET', undefined, bob.token)).data[0].from.id, alice.user.id);
      assert.equal((await call(`/friendships/${requestId}`, 'PATCH', { accept: true }, bob.token)).status, 204);
      assert.equal((await call(`/friendships/status/${bob.user.id}`, 'GET', undefined, alice.token)).data.status, 'friends');
      const detail = await call(`/movies/${movie.id}`, 'GET', undefined, alice.token);
      assert.equal(detail.data.friendsRating.rating, 3.5);
      assert.equal(detail.data.friendsWhoReviewed[0].id, bob.user.id);
      assert.equal((await call('/feed/friends', 'GET', undefined, alice.token)).data.length, 1);
      const notifications = (await call('/notifications', 'GET', undefined, alice.token)).data;
      assert.equal((await call(`/notifications/${notifications[0].id}/read`, 'PATCH', undefined, charlie.token)).status, 404);
      assert.equal((await call('/notifications/read-all', 'PATCH', undefined, alice.token)).status, 204);
      assert.ok((await call('/notifications', 'GET', undefined, alice.token)).data.every((n: any) => n.read));
    });
    await t.test('Movie home sections, search and full-catalog recommendations are chosen by the backend', async () => {
      const before = tmdbRequests;
      const featured = await prisma.movie.findUniqueOrThrow({ where: { tmdbId: 101 } });
      await prisma.movie.update({ where: { id: featured.id }, data: { featured: true } });
      const home = (await call('/movies/home', 'GET', undefined, alice.token)).data;
      assert.equal(home.list[0].id, movie.id);
      assert.equal(home.hero[0].id, featured.id);
      assert.equal(home.featured[0].id, featured.id);
      assert.equal(home.trending[0].id, movie.id);
      const searched = await call('/movies/search?q=' + encodeURIComponent('  MOVIE 102  '), 'GET', undefined, alice.token);
      assert.equal(searched.data[0].id, movie.id);
      assert.equal(searched.data[0].friendsRating.rating, 3.5);
      assert.equal((await call('/movies/search?q=')).status, 400);
      assert.equal((await call('/movies/search?q=' + 'a'.repeat(81))).status, 400);
      assert.equal((await call('/movies/invalid')).status, 400);
      assert.equal((await call('/movies/999999/recommendations')).status, 404);
      let winner = 0;
      for (let index = 0; index < 35; index++) {
        const candidate = await prisma.movie.create({ data: { title: `Recommendation ${index}`, overview: '', genres: { connect: { id: 18 } } } });
        await prisma.review.create({ data: { authorId: charlie.user.id, movieId: candidate.id, text: 'Candidate review', rating: index === 34 ? 5 : 0.5 } });
        if (index === 34) winner = candidate.id;
      }
      const recommended = (await call(`/movies/${movie.id}/recommendations`)).data;
      assert.equal(recommended.length, 6);
      assert.equal(recommended[0].id, winner);
      await prisma.movie.update({ where: { id: winner }, data: { hidden: true } });
      assert.equal((await call(`/movies/${winner}`)).status, 404);
      assert.ok(!(await call(`/movies/${movie.id}/recommendations`)).data.some((m: any) => m.id === winner));
      assert.deepEqual((await call('/movies/search?q=Recommendation%2034')).data, []);
      await prisma.movie.update({ where: { id: featured.id }, data: { featured: false } });
      assert.equal((await call('/movies/home')).data.hero[0].id, movie.id);
      assert.equal(tmdbRequests, before);
    });
    await t.test('Movie aggregates distinguish unrated reviews and exclude future reviews from trending', async () => {
      const unrated = await prisma.review.create({ data: { authorId: charlie.user.id, movieId: movie.id, text: 'Not rated yet', rating: null, createdAt: new Date(Date.now() + 86400000) } });
      const detail = (await call(`/movies/${movie.id}`)).data;
      assert.equal(detail.communityRating, 4);
      assert.equal(detail.ratingsCount, 2);
      assert.equal(detail.commentsCount, 3);
      assert.equal(detail.reviewsLast30Days, 2);
      await prisma.review.delete({ where: { id: unrated.id } });
    });
    await t.test('User updates persist with JWT authentication; administration checks roles', async () => {
      assert.equal((await call('/users', 'GET', undefined, alice.token)).status, 403);
      assert.equal((await call(`/users/${bob.user.id}/role`, 'PATCH', { role: 'superadmin' }, alice.token)).status, 403);
      assert.equal((await call('/users/me', 'PATCH', { name: 'Alice Updated', email: 'alice@example.test' }, alice.token)).data.name, 'Alice Updated');
      const otherLogin = await call('/auth/login', 'POST', { email: 'alice@example.test', password: 'Testing1234' });
      const updated = await call('/users/me', 'PATCH', { name: 'Alice Updated', email: 'newalice@example.test' }, alice.token);
      assert.equal(updated.data.email, 'newalice@example.test');
      assert.equal((await call('/auth/me', 'GET', undefined, alice.token)).data.email, 'newalice@example.test');
      assert.equal((await call('/auth/me', 'GET', undefined, otherLogin.data.token)).status, 200);
      assert.equal((await call('/users/me', 'PATCH', { name: 'Alice', email: 'bob@example.test' }, alice.token)).status, 409);
    });
    await t.test('Achievements and reward spending are persistent and cannot overspend', async () => {
      const achievements = (await call('/achievements', 'GET', undefined, alice.token)).data;
      assert.equal(achievements.totalPoints, 10); assert.equal(achievements.profile.likes, 1);
      assert.equal((await call('/rewards/redeem', 'POST', { rewardId: 'popcorn', cost: 0 }, alice.token)).status, 409);
      for (let i = 0; i < 4; i++) {
        const extra = await prisma.movie.create({ data: { title: `Extra ${i}`, overview: '' } });
        await prisma.review.create({ data: { authorId: alice.user.id, movieId: extra.id, text: 'Another review', rating: 4 } });
      }
      // first review 10 + five reviews 20 + five ratings 15 = 45, only one 30-point redemption fits.
      const results = await Promise.all([call('/rewards/redeem', 'POST', { rewardId: 'popcorn' }, alice.token), call('/rewards/redeem', 'POST', { rewardId: 'popcorn' }, alice.token)]);
      assert.equal(results.filter(r => r.status === 201).length, 1);
      assert.equal(results.filter(r => r.status === 409).length, 1);
      const rewards = (await call('/rewards', 'GET', undefined, alice.token)).data;
      assert.equal(rewards.spentPoints, 30); assert.equal(rewards.redeemed.length, 1);
      assert.ok(rewards.redeemed[0].code);
      assert.equal((await call(`/users/${alice.user.id}`)).data.stats.points, 45);
    });
    await t.test('Movie administration validates data, persists metadata and protects user roles', async () => {
      await prisma.user.update({ where: { id: charlie.user.id }, data: { role: 'superadmin' } });
      const data = { title: 'Manual movie', overview: 'A saved movie', runtime: 100, releaseDate: '2026-10-20', genres: ['Custom genre'], posterUrl: 'https://example.test/poster.jpg', featured: true };
      assert.equal((await call('/movies', 'POST', data, bob.token)).status, 403);
      assert.equal((await call('/movies', 'POST', { title: '' }, charlie.token)).status, 400);
      const created = await call('/movies', 'POST', data, charlie.token);
      assert.equal(created.status, 201);
      assert.equal(created.data.posterUrl, data.posterUrl);
      assert.deepEqual(created.data.genres, ['Custom genre']);
      const updated = await call(`/movies/${created.data.id}`, 'PATCH', { ...data, title: 'Updated manual movie', featured: false }, charlie.token);
      assert.equal(updated.status, 200); assert.equal(updated.data.title, 'Updated manual movie');
      const patched = await call(`/movies/${created.data.id}`, 'PATCH', { featured: true }, charlie.token);
      assert.equal(patched.status, 200);
      assert.equal(patched.data.title, 'Updated manual movie');
      assert.equal(patched.data.posterUrl, data.posterUrl);
      assert.deepEqual(patched.data.genres, ['Custom genre']);
      assert.equal((await call(`/movies/${created.data.id}`, 'PATCH', {}, charlie.token)).status, 400);
      assert.equal((await call(`/movies/${created.data.id}`, 'PATCH', { runtime: -5 }, charlie.token)).status, 400);
      assert.equal((await call(`/movies/${created.data.id}`, 'PATCH', { role: 'superadmin' }, charlie.token)).status, 400);
      assert.equal((await call('/users', 'GET', undefined, charlie.token)).status, 200);
      assert.equal((await call(`/users/${charlie.user.id}/role`, 'PATCH', { role: 'user' }, charlie.token)).status, 400);
      assert.equal((await call(`/users/${bob.user.id}/role`, 'PATCH', { role: 'moderator' }, charlie.token)).status, 200);
      await prisma.user.update({ where: { id: bob.user.id }, data: { role: 'user' } });
      assert.equal((await call(`/reviews/${reviewId}/like`, 'POST', undefined, bob.token)).data.liked, false);
      assert.equal((await call(`/reviews/${reviewId}/repost`, 'POST', undefined, bob.token)).data.reposted, false);
      assert.equal((await call(`/friendships/${requestId}`, 'DELETE', undefined, alice.token)).status, 204);
      assert.equal((await call('/friendships', 'GET', undefined, bob.token)).data.length, 0);
    });
    await t.test('Moderation survives TMDB refresh; deletion cascades reactions', async () => {
      await prisma.user.update({ where: { id: charlie.user.id }, data: { role: 'superadmin' } });
      assert.equal((await call(`/movies/${movie.id}`, 'DELETE', undefined, charlie.token)).status, 204);
      await syncCatalog();
      assert.equal((await call(`/movies/${movie.id}`)).status, 404);
      assert.equal((await call('/releases/now-playing')).data.length, 0);
      assert.equal((await call(`/reviews/${reviewId}`, 'DELETE', undefined, charlie.token)).status, 204);
      assert.equal(await prisma.like.count({ where: { reviewId } }), 0);
      assert.equal(await prisma.notification.count({ where: { reviewId } }), 0);
    });
  } finally {
    await close(server); await close(fakeTmdb); await close(fakeOverpass); await prisma.$disconnect(); await rm(dir, { recursive: true, force: true });
  }
});
