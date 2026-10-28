import '../src/config';
import { prisma } from '../src/prisma';
import { seedReferenceData } from './reference';
seedReferenceData().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
