import { prisma } from '../src/prisma';
import { rewards, achievements, ranks } from './reference-data';
export async function seedReferenceData() {
 for (const row of rewards) await prisma.reward.upsert({ where: { id: row.id }, create: row, update: {} });
 for (const row of achievements) await prisma.achievement.upsert({ where: { id: row.id }, create: row, update: {} });
 for (const row of ranks) await prisma.rank.upsert({ where: { min: row.min }, create: row, update: {} });
}
