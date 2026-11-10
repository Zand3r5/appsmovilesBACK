import '../src/config';
import { prisma } from '../src/prisma';
import { awardAchievements } from '../src/services/gamification';
import { withUserPoints } from '../src/services/points';

async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) await withUserPoints(user.id, tx => awardAchievements(tx, user.id));
  console.log(`Historial de puntos inicializado para ${users.length} cuentas. No se duplicaron premios ni canjes.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
