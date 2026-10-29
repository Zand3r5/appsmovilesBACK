import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

test('Upcoming Argentine re-releases retain the future date and remain visible', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'whatnext-rerelease-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  process.env.TMDB_KEY = 'fixture';
  await writeFile(path.join(dir, 'test.db'), '');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 701, title: 'Re-release', overview: '', release_date: '2000-01-01', genres: [],
      poster_path: null, backdrop_path: null,
      release_dates: { results: [{ iso_3166_1: 'AR', release_dates: [
        { type: 3, release_date: '2000-01-01T00:00:00Z' },
        { type: 3, release_date: `${future}T00:00:00Z` },
      ] }] },
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.TMDB_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  const { prisma } = await import('../src/prisma');
  try {
    const { importMovieFromTmdb } = await import('../src/services/tmdb');
    const original = await importMovieFromTmdb(701);
    assert.equal(original.releaseDate, '2000-01-01');
    const movie = await importMovieFromTmdb(701, true);
    assert.equal(movie.id, original.id);
    assert.equal(movie.releaseDate, future);
    await prisma.catalogEntry.create({ data: { movieId: movie.id, kind: 'upcoming', position: 0 } });
    const { getMovieReleases } = await import('../src/services/movies');
    const releases = await getMovieReleases('upcoming');
    assert.equal(releases.length, 1);
    assert.equal(releases[0].releaseDate, future);
  } finally {
    await prisma.$disconnect();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
