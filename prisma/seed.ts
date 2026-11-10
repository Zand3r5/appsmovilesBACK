import '../src/config';
import { prisma } from '../src/prisma';
import { seedReferenceData } from './reference';

async function main() {
  await seedReferenceData();
  console.log('Catálogo de recompensas, logros y rangos actualizado.');
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
