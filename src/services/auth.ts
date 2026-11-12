import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';
import { fail } from '../utils/http';
import { validateLogin, validateRegistration } from '../validation/auth';
import { getSessionUser } from './users';

async function createSession(userId: number) {
  const id = randomUUID();
  await prisma.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + 7 * 86400000) } });
  return jwt.sign({ sub: String(userId), sid: id }, process.env.JWT_SECRET!, { expiresIn: '7d', algorithm: 'HS256' });
}

export async function register(body: unknown) {
  const { name, email, password } = validateRegistration(body);
  if (await prisma.user.findUnique({ where: { email } })) fail(409, 'Ya existe una cuenta con ese email. Iniciá sesión');
  const user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 10) } });
  return { token: await createSession(user.id), user: await getSessionUser(user.id) };
}

export async function login(body: unknown) {
  const { email, password } = validateLogin(body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await bcrypt.compare(password, user.passwordHash)) fail(401, 'Email o contraseña incorrectos');
  return { token: await createSession(user.id), user: await getSessionUser(user.id) };
}

export async function logout(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
