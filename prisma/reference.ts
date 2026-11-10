import { prisma } from '../src/prisma';
import { rewards, achievements, ranks } from './reference-data';

export async function seedReferenceData() {
  await prisma.$transaction([
    ...rewards.map(row => prisma.reward.upsert({
      where: { id: row.id },
      create: row,
      update: { title: row.title, description: row.description, icon: row.icon, cost: row.cost },
    })),
    ...achievements.map(row => prisma.achievement.upsert({
      where: { id: row.id },
      create: row,
      update: {
        title: row.title,
        description: row.description,
        icon: row.icon,
        stat: row.stat,
        goal: row.goal,
        points: row.points,
      },
    })),
    ...ranks.map(row => prisma.rank.upsert({
      where: { min: row.min },
      create: row,
      update: { name: row.name, icon: row.icon },
    })),
  ]);
}
