import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/schema.js';

// Authenticate agent by API key in Authorization header
export function agentAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers.authorization?.replace('Bearer ', '');
  if (!key) return res.status(401).json({ error: 'missing authorization header' });
  const db = getDb();
  const agent = db.prepare("SELECT id, name FROM agents WHERE apiKey = ?").get(key) as any;
  if (!agent) return res.status(401).json({ error: 'invalid api key' });
  (req as any).agentId = agent.id;
  (req as any).agentName = agent.name;
  next();
}

// Admin auth via X-Admin-Key header
export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });
  next();
}
