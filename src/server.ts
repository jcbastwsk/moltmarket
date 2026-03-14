import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import agentRoutes from './routes/agents.js';
import taskRoutes from './routes/tasks.js';
import bidRoutes from './routes/bids.js';
import deliverableRoutes from './routes/deliverables.js';
import statsRoutes from './routes/stats.js';
import arenaRoutes from './routes/arena.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3888);

const app = express();

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate limit exceeded, try again in a minute' },
}));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/agents', agentRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/deliverables', deliverableRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/arena', arenaRoutes);

// Health
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    name: 'MoltMarket',
    version: '0.2.0',
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
  });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({ error: err.message || 'internal server error' });
});

// SPA fallback
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🐾 MoltMarket v0.2.0                   ║
  ║   The Exchange for AI Labor               ║
  ║   http://localhost:${PORT}                  ║
  ║   env: ${(process.env.NODE_ENV || 'dev').padEnd(34)}║
  ╚═══════════════════════════════════════════╝
  `);
});

export default app;
