import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { fail } from '../utils/http';
import { withJobLease } from './job';
const registration = z.object({
  id: z.uuid(), secret: z.string().regex(/^[a-f0-9]{64}$/),
  token: z.string().max(255).regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/), platform: z.enum(['ios', 'android']),
}).strict();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
// The notification row and its outbox entries commit with the social action.
// Only devices registered at event time are targeted; old events aren't replayed
// when somebody installs the app later. One actor/action/subject/device per day
// prevents unlike/re-like or withdraw/re-request loops from spamming the phone.
export async function createSocialNotification(tx: Prisma.TransactionClient, data: {
  recipientId: number; actorId: number; type: 'friend_request' | 'review_like' | 'review_repost'; reviewId?: number; friendshipId?: number;
}) {
  const notification = await tx.notification.create({ data });
  if (data.recipientId === data.actorId) return notification;
  const now = new Date();
  const devices = await tx.pushDevice.findMany({ where: { userId: data.recipientId, enabled: true, session: { expiresAt: { gt: now } } } });
  for (const device of devices) {
    const id = digest(`social:${data.recipientId}:${device.id}:${data.type}:${data.actorId}:${data.reviewId ?? 'friendship'}:${localDate(now)}`);
    await tx.pushDelivery.upsert({ where: { id }, create: { id, userId: data.recipientId, deviceId: device.id,
      kind: 'social-notification', notificationId: notification.id, nextAttemptAt: now }, update: {} });
    // Refresh only unclaimed work. A ticket or an in-flight send must retain its
    // once-per-day identity even if the original notification was removed.
    await tx.pushDelivery.updateMany({ where: { id, ticketId: null, status: { in: ['pending', 'canceled'] } },
      data: { notificationId: notification.id, status: 'pending', nextAttemptAt: now } });
  }
  return notification;
}
async function socialMessage(notificationId: number | null, userId: number, now: Date) {
  if (!notificationId) return null;
  const row = await prisma.notification.findUnique({ where: { id: notificationId }, include: { actor: { select: { name: true } }, review: { include: { movie: true } } } });
  if (!row || row.recipientId !== userId || row.actorId === userId || row.read) return null;
  if (now.getTime() - row.createdAt.getTime() >= 86400000) return null;
  const common = { channelId: 'actividad', ttl: Math.max(1, Math.floor((row.createdAt.getTime() + 86400000 - now.getTime()) / 1000)) };
  if (row.type === 'friend_request') {
    const friendship = row.friendshipId ? await prisma.friendship.findUnique({ where: { id: row.friendshipId } }) : null;
    if (!friendship || friendship.status !== 'pending' || friendship.requesterId !== row.actorId || friendship.addresseeId !== userId) return null;
    return { ...common, title: 'Nueva solicitud de amistad', body: `${row.actor.name} quiere ser tu amigo en WhatNext.`,
      data: { kind: 'friend-request', notificationId: row.id, userId: row.actorId, friendshipId: friendship.id } };
  }
  if (!row.review || row.review.authorId !== userId || row.review.movie.hidden) return null;
  const where = { userId_reviewId: { userId: row.actorId, reviewId: row.review.id } };
  const active = row.type === 'review_like' ? await prisma.like.findUnique({ where })
    : row.type === 'review_repost' ? await prisma.repost.findUnique({ where }) : null;
  if (!active) return null;
  return { ...common, title: row.type === 'review_like' ? 'Le gustó tu reseña' : 'Compartieron tu reseña',
    body: `${row.actor.name} ${row.type === 'review_like' ? 'le dio me gusta a' : 'compartió'} tu reseña de ${row.review.movie.title}.`,
    data: { kind: row.type === 'review_like' ? 'review-like' : 'review-repost', notificationId: row.id, movieId: row.review.movieId, reviewId: row.review.id } };
}
export async function registerPushDevice(userId: number, sessionId: string, body: unknown) {
  const parsed = registration.safeParse(body);
  if (!parsed.success) fail(400, 'Registro de dispositivo inválido');
  const { id, secret, token, platform } = parsed.data;
  const secretHash = digest(secret);
  await prisma.$transaction(async tx => {
    const previous = await tx.pushDevice.findUnique({ where: { id } });
    if (previous && !timingSafeEqual(Buffer.from(previous.secretHash), Buffer.from(secretHash))) fail(403, 'El dispositivo no pertenece a esta instalación');
    await tx.pushDevice.upsert({ where: { id }, create: { id, secretHash, token, platform, userId, sessionId },
      update: { token, platform, userId, sessionId, enabled: true } });
    if (previous && (!previous.enabled || previous.token !== token)) await tx.pushDelivery.updateMany({ where: { deviceId: id, userId, status: 'failed', error: 'DeviceNotRegistered' }, data: { status: 'pending', attempts: 0, nextAttemptAt: new Date() } });
  });
  return { id, enabled: true };
}
export async function unregisterPushDevice(userId: number, id: string, secret: unknown) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) fail(400, 'Dispositivo inválido');
  await prisma.pushDevice.deleteMany({ where: { id, userId, secretHash: digest(secret) } });
}
async function expo(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${process.env.EXPO_PUSH_BASE_URL ?? 'https://exp.host/--/api/v2/push'}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Expo HTTP ${response.status}`);
  const result = await response.json() as any;
  if (result.errors?.length) throw new Error('Expo rechazó la solicitud');
  return result.data;
}
function localDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export async function runPushDelivery(now = new Date()) {
  return withJobLease('notification-push', async () => {
    const today = localDate(now), due = new Date(`${today}T10:00:00-03:00`);
    if (now >= due) {
      const reminders = await prisma.releaseReminder.findMany({
        where: { movie: { releaseDate: today, hidden: false }, createdAt: { lte: due } },
        include: { user: { include: { pushDevices: { where: { enabled: true, session: { expiresAt: { gt: now } } } } } } },
      });
      for (const reminder of reminders) for (const device of reminder.user.pushDevices) {
        const id = digest(`${reminder.userId}:${device.id}:${reminder.movieId}:${today}`);
        await prisma.pushDelivery.upsert({ where: { id }, create: { id, userId: reminder.userId, movieId: reminder.movieId, deviceId: device.id, releaseDate: today, nextAttemptAt: now }, update: {} });
      }
    }
    const deliveries = await prisma.pushDelivery.findMany({ where: {
      OR: [{ status: 'pending', nextAttemptAt: { lte: now } }, { status: 'sending', updatedAt: { lt: new Date(now.getTime() - 120000) } }],
    }, orderBy: { createdAt: 'asc' }, take: 100 });
    let sent = 0;
    for (const delivery of deliveries) {
      const claim = await prisma.pushDelivery.updateMany({ where: { id: delivery.id, status: delivery.status, updatedAt: delivery.updatedAt }, data: { status: 'sending', attempts: { increment: 1 } } });
      if (!claim.count) continue;
      const device = delivery.deviceId ? await prisma.pushDevice.findUnique({ where: { id: delivery.deviceId }, include: { session: true } }) : null;
      let message: { channelId: string; title: string; body: string; ttl: number; data: object } | null = null;
      if (device?.enabled && device.userId === delivery.userId && device.session.expiresAt > now) {
        if (delivery.kind === 'social-notification') message = await socialMessage(delivery.notificationId, delivery.userId, now);
        else if (delivery.kind === 'release-reminder' && delivery.movieId) {
          const movie = await prisma.movie.findUnique({ where: { id: delivery.movieId } });
          const subscription = await prisma.releaseReminder.findUnique({ where: { userId_movieId: { userId: delivery.userId, movieId: delivery.movieId } } });
          if (subscription && movie && !movie.hidden && movie.releaseDate === today && delivery.releaseDate === today) {
            message = { channelId: 'estrenos', title: '🎬 ¡Hoy se estrena!', body: `${movie.title} ya está en cines. ¿Vas a verla?`,
              ttl: Math.max(60, Math.floor((new Date(`${today}T23:59:59-03:00`).getTime() - now.getTime()) / 1000)),
              data: { kind: 'release-reminder', movieId: movie.id } };
          }
        }
      }
      if (!message || !device) {
        await prisma.pushDelivery.update({ where: { id: delivery.id }, data: { status: 'canceled' } }); continue;
      }
      try {
        const tickets = await expo('send', [{ to: device.token, sound: 'default', ...message, data: { ...message.data, deliveryId: delivery.id } }]);
        const ticket = tickets?.[0];
        if (ticket?.status === 'ok' && typeof ticket.id === 'string') {
          await prisma.pushDelivery.update({ where: { id: delivery.id }, data: { status: 'ticketed', ticketId: ticket.id, nextAttemptAt: new Date(now.getTime() + 15 * 60000), error: null } }); sent++;
        } else await pushFailure(delivery.id, device.id, ticket?.details?.error ?? 'InvalidTicket', delivery.attempts + 1, now);
      } catch { await pushFailure(delivery.id, device.id, 'TransportError', delivery.attempts + 1, now); }
    }
    await checkReceipts(now);
    return { sent };
  });
}
async function pushFailure(id: string, deviceId: string, error: string, attempts: number, now: Date) {
  if (error === 'DeviceNotRegistered') await prisma.pushDevice.updateMany({ where: { id: deviceId }, data: { enabled: false } });
  const retry = ['TransportError', 'MessageRateExceeded', 'ExpoServerError'].includes(error) && attempts < 6;
  await prisma.pushDelivery.update({ where: { id }, data: { status: retry ? 'pending' : 'failed', error: error.slice(0, 100), nextAttemptAt: new Date(now.getTime() + Math.min(3600, 60 * 2 ** attempts) * 1000) } });
}
async function checkReceipts(now: Date) {
  const rows = await prisma.pushDelivery.findMany({ where: { status: 'ticketed', nextAttemptAt: { lte: now } }, take: 100 });
  if (!rows.length) return;
  let receipts: any;
  try { receipts = await expo('getReceipts', { ids: rows.map(row => row.ticketId) }); }
  catch { return; }
  for (const row of rows) {
    const receipt = receipts?.[row.ticketId!];
    if (!receipt) {
      const expired = now.getTime() - row.createdAt.getTime() > 24 * 3600000;
      await prisma.pushDelivery.update({ where: { id: row.id }, data: { status: expired ? 'failed' : 'ticketed', error: expired ? 'ReceiptMissing' : null, nextAttemptAt: new Date(now.getTime() + 15 * 60000) } });
    } else if (receipt.status === 'ok') {
      await prisma.pushDelivery.update({ where: { id: row.id }, data: { status: 'delivered', receiptCheckedAt: now } });
    } else {
      if (row.deviceId) await pushFailure(row.id, row.deviceId, receipt.details?.error ?? 'ReceiptError', row.attempts, now);
      else await prisma.pushDelivery.update({ where: { id: row.id }, data: { status: 'canceled' } });
    }
  }
}

export async function pushDeviceStatus(userId: number, sessionId: string) {
  const devices = await prisma.pushDevice.findMany({ where: { userId, sessionId }, select: { platform: true, enabled: true, updatedAt: true } });
  const deliveries = await prisma.pushDelivery.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5,
    select: { kind: true, status: true, createdAt: true, receiptCheckedAt: true, error: true } });
  return { devices, deliveries };
}
export async function sendPushTest(userId: number, sessionId: string) {
  const devices = await prisma.pushDevice.findMany({ where: { userId, sessionId, enabled: true, session: { expiresAt: { gt: new Date() } } } });
  if (!devices.length) fail(409, 'Este dispositivo no está registrado para push. Usá una compilación de desarrollo y activá las notificaciones.');
  let data: any;
  try { data = await expo('send', devices.map(device => ({ to: device.token, sound: 'default', channelId: 'estrenos',
    title: 'WhatNext · Prueba de notificaciones', body: 'La conexión push de este dispositivo está configurada.', ttl: 300, data: { kind: 'push-test' } }))); }
  catch { fail(502, 'No se pudo contactar al servicio de notificaciones. Intentá nuevamente.'); }
  const accepted = devices.filter((_, index) => data?.[index]?.status === 'ok').length;
  for (let i = 0; i < devices.length; i++) if (data?.[i]?.details?.error === 'DeviceNotRegistered') await prisma.pushDevice.updateMany({ where: { id: devices[i].id }, data: { enabled: false } });
  if (!accepted) fail(502, 'El servicio rechazó la prueba. Revisá las credenciales push y el registro del dispositivo.');
  return { accepted, message: 'La prueba fue aceptada para envío. Esto no confirma que el teléfono la haya mostrado.' };
}
