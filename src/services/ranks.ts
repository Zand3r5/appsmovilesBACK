// Los umbrales se leen ordenados para encontrar el rango actual y el siguiente.
import { prisma } from '../prisma';
export async function calculateRank(reviewCount: number) {
  const RANKS = await prisma.rank.findMany({ orderBy: { min: 'asc' } });
  const index = RANKS.filter((rank) => reviewCount >= rank.min).length - 1;
  const current = index >= 0 ? RANKS[index] : null;
  const next = RANKS[index + 1] ?? null;
  const currentMin = current?.min ?? 0;

  return {
    current,
    next,
    index,
    progress: next ? (reviewCount - currentMin) / (next.min - currentMin) : 1,
  };
}
