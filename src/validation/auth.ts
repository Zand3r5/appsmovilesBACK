import { z } from 'zod';
import { fail } from '../utils/http';

const email = z.string().trim().toLowerCase().email().max(120);
const bcryptPassword = z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 72);
const strongPassword = bcryptPassword
  .min(8)
  .refine(value => /[A-Za-z]/.test(value) && /\d/.test(value));

const registerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email,
  password: strongPassword,
}).strict();

const loginSchema = z.object({ email, password: bcryptPassword }).strict();

const changePasswordSchema = z.object({
  currentPassword: bcryptPassword,
  newPassword: strongPassword,
}).strict();

export function validateRegistration(body: unknown) {
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    fail(400, 'Ingresá un nombre, email y contraseña de al menos 8 caracteres con letras y números y hasta 72 bytes UTF-8');
  }
  return parsed.data;
}

export function validateLogin(body: unknown) {
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) fail(400, 'Completá email y contraseña (máximo 72 bytes UTF-8)');
  return parsed.data;
}

export function validatePasswordChange(body: unknown) {
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    fail(400, 'Ingresá tu contraseña actual y una nueva de 8 a 72 bytes, con letras y números');
  }
  return parsed.data;
}
