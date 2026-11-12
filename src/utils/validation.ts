import { fail } from './http';

export function parseId(value: unknown){
    const id= Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export function requireId(value: unknown) {
  const id = parseId(value);
  if (!id) fail(400, 'El id no es válido');
  return id;
}

export function cleanText(value: unknown, max: number){
if (typeof value !== 'string') return null;
const text = value.trim();
return text.length > 0 && text.length <= max ? text : null;
}

export function cleanEmail(value: unknown){
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120 ? email : null;
}

export function isBcryptPassword(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72;
}

export function isStrongPassword(value: unknown): value is string {
  return isBcryptPassword(value) && value.length >= 8
    && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export function isPhoto(value: unknown) {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.length <= 2_000_000
    && (/^data:image\/(jpeg|jpg|png|webp);base64,/.test(value) || /^\/media\/[0-9a-f-]{36}\.webp$/.test(value) || /^https?:\/\/[^/]+\/media\/[0-9a-f-]{36}\.webp$/.test(value));
}
