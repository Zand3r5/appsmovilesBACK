import { z } from 'zod';
import { parseId } from '../utils/validation';
import { fail } from '../utils/http';
const image = z.string().max(1500000).refine(s => /^\/media\/[0-9a-f-]{36}\.webp$/.test(s) || /^https?:\/\//.test(s) || /^data:image\/(jpeg|jpg|png);base64,/.test(s)).nullable();
const person = z.object({ name: z.string().trim().min(1).max(150), character: z.string().max(150) });
const movieSchema = z.object({
  title: z.string().trim().min(1).max(200), overview: z.string().trim().min(1).max(10000),
  tmdbId: z.number().int().positive().nullable().optional(),
  releaseDate: z.iso.date(), runtime: z.coerce.number().int().positive().max(2000),
  genres: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  actors: z.array(person).max(50).default([]), directors: z.array(z.string().max(150)).max(20).default([]),
  crew: z.array(z.object({ name: z.string().max(150), job: z.string().max(150) })).max(50).default([]),
  trailers: z.array(z.object({ name: z.string().max(150), key: z.string().regex(/^[\w-]{11}$/), site: z.literal('YouTube') })).max(10).default([]),
  watchProviders: z.object({ AR: z.object({ stream: z.array(z.string().max(100)).max(50), rent: z.array(z.string().max(100)).max(50), buy: z.array(z.string().max(100)).max(50) }) }).default({ AR: { stream: [], rent: [], buy: [] } }),
  posterUrl: image, backdropUrl: image.optional(), featured: z.boolean().default(false),
});

export type MovieInput = z.infer<typeof movieSchema>;
export function validateMovieInput(body: unknown, partial = false): Partial<MovieInput> {
  const parsed = (partial ? movieSchema.partial().strict() : movieSchema.strict()).safeParse(body);
  if (!parsed.success) fail(400, parsed.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; '));
  // Patch only submitted fields; defaults from create must not erase existing metadata.
  const data = partial
    ? Object.fromEntries(Object.entries(parsed.data).filter(([key]) => Object.prototype.hasOwnProperty.call(body, key)))
    : parsed.data;
  if (!Object.keys(data).length) fail(400, 'Indicá al menos un campo para modificar');
  return data;
}
export function movieSearchQuery(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80) {
    fail(400, 'Escribí entre 1 y 80 caracteres');
  }
  return value.trim();
}

export function movieId(value: unknown) {
  const id = parseId(value);
  if (!id) fail(400, 'El id no es válido');
  return id;
}
