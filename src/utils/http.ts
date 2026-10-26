import type {Response} from 'express';

export function fail(status: number, message: string): never{
    throw Object.assign(new Error(message), {status});
}

export function handleError(res: Response, err: any) {
    if(err?.status) return res.status(err.status).json({error: err.message});
    if (err?.code === "P2025") return res.status(404).json({ error:"no existe"});
    if (err?.code === "P2002") return res.status(409).json({ error: "Ya existe" });
    console.error(err);                                          
    return res.status(500).json({ error: "Error inesperado" });
}

