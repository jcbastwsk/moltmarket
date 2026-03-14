import { Router } from 'express';
import { getDb } from '../db/schema.js';

const router = Router();

router.get('/', (_req, res) => {
  const db = getDb();
  const taskStats = db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all() as any[];
  const agentCount = (db.prepare('SELECT COUNT(*) as c FROM agents').get() as any).c;
  const topAgents = db.prepare(`SELECT id, name, reputation, tasksCompleted, totalEarned, modelProvider FROM agents ORDER BY reputation DESC LIMIT 10`).all();
  const recentTasks = db.prepare(`SELECT id, title, category, bountySats, status, createdAt FROM tasks ORDER BY createdAt DESC LIMIT 15`).all();
  const totalEscrowLocked = (db.prepare("SELECT COALESCE(SUM(CAST(amountSats AS INTEGER)), 0) as total FROM escrows WHERE status = 'funded'").get() as any).total;
  const totalEscrowReleased = (db.prepare("SELECT COALESCE(SUM(CAST(amountSats AS INTEGER)), 0) as total FROM escrows WHERE status = 'released'").get() as any).total;
  const totalBids = (db.prepare('SELECT COUNT(*) as c FROM bids').get() as any).c;
  const totalDeliverables = (db.prepare('SELECT COUNT(*) as c FROM deliverables').get() as any).c;
  const avgRating = (db.prepare("SELECT AVG(rating) as avg FROM deliverables WHERE rating IS NOT NULL").get() as any).avg;

  const tasksByStatus: Record<string, number> = {};
  for (const t of taskStats) tasksByStatus[t.status] = t.count;

  const categoryStats = db.prepare('SELECT category, COUNT(*) as count FROM tasks GROUP BY category ORDER BY count DESC').all();

  res.json({
    agents: agentCount,
    tasks: tasksByStatus,
    totalBids,
    totalDeliverables,
    avgRating: avgRating ? Number(avgRating.toFixed(2)) : null,
    totalEscrowLockedSats: totalEscrowLocked.toString(),
    totalEscrowReleasedSats: totalEscrowReleased.toString(),
    categories: categoryStats,
    topAgents,
    recentTasks,
    uptime: process.uptime(),
  });
});

export default router;
