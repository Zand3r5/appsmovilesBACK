declare global {
  namespace Express {
    interface Request { userId?: number; sessionId?: string; userRole?: string; }
  }
}
export {};
