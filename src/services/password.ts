import bcrypt from 'bcrypt';
import { prisma } from '../prisma';
import { isStrongPassword } from '../utils/validation';
import { fail } from '../utils/http';

export async function changePassword(userId: number, sessionId: string, currentPassword: unknown, newPassword: unknown) {
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 72) fail(400, 'Ingresá tu contraseña actual');
  if (!isStrongPassword(newPassword) || Buffer.byteLength(newPassword as string, 'utf8') > 72) {
    fail(400, 'Elegí una contraseña de 8 a 72 caracteres, con letras y números. Si usás símbolos especiales, elegí una más corta.');
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) fail(400, 'La contraseña actual es incorrecta');
  if (await bcrypt.compare(newPassword as string, user.passwordHash)) fail(400, 'La nueva contraseña debe ser diferente de la actual');
  const passwordHash = await bcrypt.hash(newPassword as string, 10);
  await prisma.$transaction(async tx => {
    // Compare-and-swap serializes concurrent changes verified against the same old password.
    const changed = await tx.user.updateMany({ where: { id: userId, passwordHash: user.passwordHash }, data: { passwordHash } });
    if (!changed.count) fail(409, 'Tu contraseña ya cambió. Volvé a intentarlo con tu contraseña actual');
    const session = await tx.session.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() } } });
    if (!session) fail(401, 'Tu sesión venció, volvé a iniciar sesión');
    // Keep this verified session and its push device; revoke access on every other session.
    await tx.session.deleteMany({ where: { userId, id: { not: sessionId } } });
  });
  return { message: 'Contraseña actualizada. Se cerraron las sesiones en los demás dispositivos.' };
}
