import '../src/config';
import { prisma } from '../src/prisma';
import { getAchievements } from '../src/services/gamification';
async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) await getAchievements(user.id);
  console.log(`Historial de puntos inicializado para ${users.length} cuentas. No se duplicaron premios ni canjes.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
