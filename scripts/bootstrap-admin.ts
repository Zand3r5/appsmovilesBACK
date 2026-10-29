import '../src/config';
import bcrypt from 'bcrypt';
import { prisma } from '../src/prisma';
import { cleanEmail, cleanText, isStrongPassword } from '../src/utils/validation';
async function main() {
  const email = cleanEmail(process.env.ADMIN_EMAIL), name = cleanText(process.env.ADMIN_NAME, 60), password = process.env.ADMIN_PASSWORD;
  if (!email || !name || !isStrongPassword(password)) throw new Error('Configurá ADMIN_EMAIL, ADMIN_NAME y ADMIN_PASSWORD (al menos 8 caracteres, letras y números, máximo 72 bytes UTF-8)');
  if (await prisma.user.count({ where: { role: 'superadmin' } })) throw new Error('Ya existe un superadmin. Usá la administración de usuarios');
  if (await prisma.user.findUnique({ where: { email } })) throw new Error('El email ya existe; no se modificó su rol');
  await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password!, 12), role: 'superadmin' } });
  console.log('Administrador creado');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
