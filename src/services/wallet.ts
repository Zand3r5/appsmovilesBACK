import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, createPrivateKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PKPass } from 'passkit-generator';
import sharp from 'sharp';
import { prisma } from '../prisma';
import { fail } from '../utils/http';

export type WalletProvider = 'apple' | 'google';
// Domain-separated signing key: a browser download ticket must never authenticate API requests.
const downloadKey = () => createHmac('sha256', process.env.JWT_SECRET!).update('whatnext.apple-download.v1').digest();
const appleVariables = ['WALLET_APPLE_PASS_TYPE_ID', 'WALLET_APPLE_TEAM_ID', 'WALLET_APPLE_CERT_PATH', 'WALLET_APPLE_KEY_PATH', 'WALLET_APPLE_WWDR_PATH', 'WALLET_PUBLIC_BASE_URL'];
const googleVariables = ['WALLET_GOOGLE_ISSUER_ID', 'WALLET_GOOGLE_CLASS_ID', 'WALLET_GOOGLE_CREDENTIALS_PATH'];
const iconPath = () => process.env.WALLET_APPLE_ICON_PATH || path.resolve(__dirname, '../../assets/wallet/icon@3x.png');
async function readable(files: string[]) {
  try { await Promise.all(files.map(file => access(file))); return true; } catch { return false; }
}
export async function walletAvailability() {
  const apple = appleVariables.every(key => !!process.env[key]) && await readable([process.env.WALLET_APPLE_CERT_PATH!, process.env.WALLET_APPLE_KEY_PATH!, process.env.WALLET_APPLE_WWDR_PATH!, iconPath()]);
  const google = googleVariables.every(key => !!process.env[key]) && await readable([process.env.WALLET_GOOGLE_CREDENTIALS_PATH!]);
  return {
    apple: { available: apple, reason: apple ? null : 'Apple Wallet todavía no está habilitado. Tu código de canje sigue disponible.' },
    google: { available: google, reason: google ? null : 'Google Wallet todavía no está habilitado. Tu código de canje sigue disponible.' },
  };
}
export async function activeVoucher(userId: number, id: number) {
  const row = await prisma.redemption.findFirst({ where: { id, userId }, include: { user: { select: { name: true } }, reward: true } });
  if (!row) fail(404, 'Canje no encontrado');
  if (row.status !== 'active' || row.usedAt || row.refundedAt || row.expiresAt <= new Date()) fail(409, 'Solo podés agregar a Wallet un canje disponible y vigente');
  return { ...row, reward: row.reward };
}
function publicBase() {
  let url: URL;
  try { url = new URL(process.env.WALLET_PUBLIC_BASE_URL!); } catch { fail(503, 'Falta configurar la dirección pública de Wallet'); }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) fail(503, 'Wallet requiere una dirección pública HTTPS válida');
  return url.toString().replace(/\/$/, '');
}
export async function createWalletLink(userId: number, sessionId: string, id: number, provider: WalletProvider) {
  const row = await activeVoucher(userId, id);
  const availability = await walletAvailability();
  if (!availability[provider].available) fail(503, availability[provider].reason!);
  if (provider === 'apple') {
    const ticket = jwt.sign({ sub: String(userId), redemptionId: id, sid: sessionId }, downloadKey(), { algorithm: 'HS256', expiresIn: '2m', audience: 'apple-pass', issuer: 'whatnext-wallet' });
    return { provider, url: `${publicBase()}/api/wallet/apple/${id}.pkpass?ticket=${encodeURIComponent(ticket)}`, expiresIn: 120 };
  }
  const credentials = JSON.parse(await readFile(process.env.WALLET_GOOGLE_CREDENTIALS_PATH!, 'utf8'));
  if (!credentials.client_email || !credentials.private_key) fail(503, 'Credenciales de Google Wallet incompletas');
  const issuerId = process.env.WALLET_GOOGLE_ISSUER_ID!, classId = process.env.WALLET_GOOGLE_CLASS_ID!;
  if (!/^\d+$/.test(issuerId) || !classId.startsWith(`${issuerId}.`)) fail(503, 'Clase o emisor de Google Wallet inválido');
  const localized = (value: string) => ({ defaultValue: { language: 'es-AR', value } });
  const objectId = `${issuerId}.whatnext_${createHash('sha256').update(row.code).digest('hex').slice(0, 24)}`;
  const object = {
    id: objectId, classId, state: 'ACTIVE', genericType: 'GENERIC_TYPE_UNSPECIFIED',
    cardTitle: localized('WhatNext'), header: localized(row.reward?.title ?? 'Premio WhatNext'), subheader: localized('Vale de recompensa'),
    hexBackgroundColor: '#131313', barcode: { type: 'QR_CODE', value: row.code, alternateText: row.code },
    textModulesData: [{ id: 'holder', header: 'Titular', body: row.user.name }, { id: 'terms', header: 'Condiciones', body: 'Canje de un solo uso. El personal debe validar el código en WhatNext antes de entregar el premio. No es una reserva de función ni asiento.' }],
    validTimeInterval: { start: { date: row.createdAt.toISOString() }, end: { date: row.expiresAt.toISOString() } },
    ...(process.env.WALLET_LOGO_URL ? { logo: { sourceUri: { uri: process.env.WALLET_LOGO_URL } } } : {}),
  };
  const token = jwt.sign({ iss: credentials.client_email, aud: 'google', typ: 'savetowallet',
    ...(process.env.WALLET_GOOGLE_ORIGINS ? { origins: process.env.WALLET_GOOGLE_ORIGINS.split(',').map(value => value.trim()).filter(Boolean) } : {}),
    payload: { genericObjects: [object] },
  }, createPrivateKey(credentials.private_key), { algorithm: 'RS256', expiresIn: '10m' });
  return { provider, url: `https://pay.google.com/gp/v/save/${token}`, expiresIn: 600 };
}
export async function authorizeAppleDownload(id: number, ticket: unknown) {
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(typeof ticket === 'string' ? ticket : '', downloadKey(), { algorithms: ['HS256'], audience: 'apple-pass', issuer: 'whatnext-wallet' }) as jwt.JwtPayload; }
  catch { fail(401, 'El enlace de Wallet venció. Volvé a abrirlo desde tus canjes.'); }
  if (payload.redemptionId !== id || typeof payload.sid !== 'string') fail(401, 'Enlace de Wallet inválido');
  const session = await prisma.session.findUnique({ where: { id: payload.sid } });
  if (!session || session.userId !== Number(payload.sub) || session.expiresAt <= new Date()) fail(401, 'Tu sesión ya no está activa');
  return activeVoucher(session.userId, id);
}
export async function applePass(row: Awaited<ReturnType<typeof activeVoucher>>) {
  const availability = await walletAvailability();
  if (!availability.apple.available) fail(503, availability.apple.reason!);
  const [signerCert, signerKey, wwdr, icon] = await Promise.all([
    readFile(process.env.WALLET_APPLE_CERT_PATH!), readFile(process.env.WALLET_APPLE_KEY_PATH!), readFile(process.env.WALLET_APPLE_WWDR_PATH!), readFile(iconPath()),
  ]);
  const pass = new PKPass({ 'icon.png': await sharp(icon).resize(29, 29).png().toBuffer(), 'icon@2x.png': await sharp(icon).resize(58, 58).png().toBuffer(), 'icon@3x.png': icon },
    { signerCert, signerKey, wwdr, ...(process.env.WALLET_APPLE_KEY_PASSPHRASE ? { signerKeyPassphrase: process.env.WALLET_APPLE_KEY_PASSPHRASE } : {}) },
    { formatVersion: 1, passTypeIdentifier: process.env.WALLET_APPLE_PASS_TYPE_ID!, teamIdentifier: process.env.WALLET_APPLE_TEAM_ID!, serialNumber: `whatnext-${row.id}`, organizationName: 'WhatNext', description: row.reward?.title ?? 'Vale WhatNext', logoText: 'WhatNext', backgroundColor: 'rgb(19, 19, 19)', foregroundColor: 'rgb(255, 255, 255)', labelColor: 'rgb(235, 190, 65)' });
  pass.type = 'coupon';
  pass.primaryFields.push({ key: 'reward', label: 'PREMIO', value: row.reward?.title ?? 'Vale WhatNext' });
  pass.secondaryFields.push({ key: 'holder', label: 'TITULAR', value: row.user.name });
  pass.auxiliaryFields.push({ key: 'expires', label: 'VENCE', value: row.expiresAt.toISOString(), dateStyle: 'PKDateStyleShort', timeStyle: 'PKDateStyleNone' });
  pass.backFields.push({ key: 'terms', label: 'Condiciones', value: 'Vale de un solo uso. El personal debe validar el código en WhatNext antes de entregar el premio. No es una reserva de función ni asiento. El estado del código en el servidor determina su validez.' });
  pass.setExpirationDate(row.expiresAt);
  pass.setBarcodes({ format: 'PKBarcodeFormatQR', message: row.code, messageEncoding: 'iso-8859-1', altText: row.code });
  return pass.getAsBuffer();
}
