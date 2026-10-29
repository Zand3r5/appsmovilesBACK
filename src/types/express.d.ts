declare global {
  namespace Express {
    interface Request { userId?: number; sessionId?: string; }
  }
}
export {};
