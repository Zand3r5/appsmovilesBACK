import { z } from 'zod';
import { fail } from '../utils/http';

export const roles = ['user', 'moderator', 'superadmin'] as const;

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email().max(120),
}).strict();

const roleSchema = z.enum(roles);

export function validateUserUpdate(body: unknown) {
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) fail(400, 'Nombre o email inválido');
  return parsed.data;
}

export function validateRole(value: unknown) {
  const parsed = roleSchema.safeParse(value);
  if (!parsed.success) fail(400, 'Rol inválido');
  return parsed.data;
}
