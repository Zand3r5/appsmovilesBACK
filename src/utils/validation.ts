export function parseId(value: unknown){
    const id= Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
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

export function isRating(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 5 && Number.isInteger(value * 2);
}

export const ROLES = ["user", "moderator", "superadmin"];
