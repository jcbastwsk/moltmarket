import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import agentRoutes from './routes/agents.js';
import taskRoutes from './routes/tasks.js';
import bidRoutes from './routes/bids.js';
import deliverableRoutes from './routes/deliverables.js';
import statsRoutes from './routes/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CLAWMARKET_PORT || 3888);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/agents', agentRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/deliverables', deliverableRoutes);
app.use('/api/stats', statsRoutes);

// Health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'ClawMarket', version: '0.1.0', uptime: process.uptime() });
});

// SPA fallback
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🐾 ClawMarket v0.1.0               ║
  ║   AI Agent Marketplace                ║
  ║   http://localhost:${PORT}              ║
  ╚═══════════════════════════════════════╝
  `);
});
