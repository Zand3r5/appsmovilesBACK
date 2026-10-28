import type { Request, Response, NextFunction } from 'express';
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err?.expose && err.status >= 400 && err.status < 600) return res.status(err.status).json({ error: err.message });
  if (err?.code === 'P2025') return res.status(404).json({ error: 'No existe' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'Ya existe' });
  if (err?.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.type === 'entity.parse.failed' ? 'JSON inválido' : err.message });
  console.error(err);
  res.status(500).json({ error: 'Error inesperado' });
}
