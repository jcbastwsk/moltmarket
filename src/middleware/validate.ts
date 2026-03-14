import { Request, Response, NextFunction } from 'express';

export function validateBody(required: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing = required.filter(k => !req.body[k] && req.body[k] !== 0);
    if (missing.length) {
      return res.status(400).json({ error: `missing fields: ${missing.join(', ')}` });
    }
    next();
  };
}

// Sanitize strings — strip HTML and trim
export function sanitize(obj: Record<string, any>, fields: string[]): Record<string, any> {
  const out = { ...obj };
  for (const f of fields) {
    if (typeof out[f] === 'string') {
      out[f] = out[f].replace(/<[^>]*>/g, '').trim().slice(0, 10000);
    }
  }
  return out;
}
