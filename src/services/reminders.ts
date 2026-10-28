import { prisma } from '../prisma';
import { fail } from '../utils/http';

// Argentina releases are delivered at 10:00 Buenos Aires time, independent of the device timezone.
export function releaseReminderTime(releaseDate: string | null, now = new Date()): string | null {
  if (!releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return null;
  const date = new Date(`${releaseDate}T10:00:00-03:00`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== releaseDate || date <= now) return null;
  return date.toISOString();
}
function reminderDTO(row: { movieId: number; movie: { title: string; releaseDate: string | null }; createdAt: Date }) {
  return { movieId: row.movieId, title: row.movie.title, releaseDate: row.movie.releaseDate,
    remindAt: releaseReminderTime(row.movie.releaseDate), createdAt: row.createdAt };
}
export async function getReleaseReminders(userId: number) {
  const rows = await prisma.releaseReminder.findMany({ where: { userId, movie: { hidden: false } }, include: { movie: true }, orderBy: { createdAt: 'asc' } });
  return rows.map(reminderDTO);
}
export async function subscribeToRelease(userId: number, movieId: number) {
  const row = await prisma.$transaction(async tx => {
    const movie = await tx.movie.findFirst({ where: { id: movieId, hidden: false } });
    if (!movie) fail(404, 'Película no encontrada');
    if (!releaseReminderTime(movie.releaseDate)) fail(409, 'Esta película no tiene un estreno futuro para programar un aviso');
    return tx.releaseReminder.upsert({ where: { userId_movieId: { userId, movieId } },
      create: { userId, movieId }, update: {}, include: { movie: true } });
  });
  return reminderDTO(row);
}
export async function unsubscribeFromRelease(userId: number, movieId: number) {
  await prisma.releaseReminder.deleteMany({ where: { userId, movieId } });
}
