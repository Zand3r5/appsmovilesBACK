import { z } from 'zod';
import { fail } from '../utils/http';
import { isPhoto } from '../utils/validation';

const reviewSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  rating: z.number().min(0).max(5).refine(value => Number.isInteger(value * 2)),
  photo: z.string().min(1).max(2_000_000).refine(isPhoto),
}).strict();

export type ReviewInput = z.infer<typeof reviewSchema>;

export function validateReviewInput(body: unknown): ReviewInput {
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) fail(400, 'Reseña inválida: revisá texto, puntaje y foto');
  return parsed.data;
}
