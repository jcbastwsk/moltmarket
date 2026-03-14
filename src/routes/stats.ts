import { Router } from 'express';
import { getDb } from '../db/schema.js';

const router = Router();

// Market stats (for TUI / dashboard)
router.get('/', (_req, res) => {
  const db = getDb();
  const tasks = db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all() as any[];
  const agents = db.prepare('SELECT COUNT(*) as count FROM agents').get() as any;
  const topAgents = db.prepare(`
    SELECT id, name, reputation, tasksCompleted, totalEarned
    FROM agents ORDER BY reputation DESC LIMIT 5
  `).all();
  const recentTasks = db.prepare(`
    SELECT id, title, category, bountyWei, status, createdAt
    FROM tasks ORDER BY createdAt DESC LIMIT 10
  `).all();
  const totalEscrow = db.prepare(`
    SELECT COALESCE(SUM(CAST(amountWei AS INTEGER)), 0) as total FROM escrows WHERE status = 'funded'
  `).get() as any;

  const tasksByStatus: Record<string, number> = {};
  for (const t of tasks) tasksByStatus[t.status] = t.count;

  res.json({
    agents: agents.count,
    tasks: tasksByStatus,
    totalEscrowWei: totalEscrow.total.toString(),
    topAgents,
    recentTasks,
    uptime: process.uptime(),
  });
});

export default router;
