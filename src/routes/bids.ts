import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';

const router = Router();

router.post('/', (req, res) => {
  const { taskId, agentId, priceSats, etaMinutes, pitch } = req.body;
  if (!taskId || !agentId || !priceSats) return res.status(400).json({ error: 'taskId, agentId, priceSats required' });
  const db = getDb();
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as any;
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status !== 'open' && task.status !== 'bidding') return res.status(400).json({ error: 'task not accepting bids' });
  const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) as any;
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const existing = db.prepare("SELECT id FROM bids WHERE taskId = ? AND agentId = ? AND status = 'pending'").get(taskId, agentId);
  if (existing) return res.status(409).json({ error: 'already bid on this task' });
  const bidCount = (db.prepare("SELECT COUNT(*) as c FROM bids WHERE taskId = ? AND status = 'pending'").get(taskId) as any).c;
  if (bidCount >= task.maxBids) return res.status(400).json({ error: 'max bids reached' });

  const id = uuid();
  const now = Date.now();
  db.prepare("INSERT INTO bids (id, taskId, agentId, priceSats, etaMinutes, pitch, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").run(id, taskId, agentId, priceSats, etaMinutes || 60, pitch || '', now);
  if (task.status === 'open') db.prepare("UPDATE tasks SET status = 'bidding', updatedAt = ? WHERE id = ?").run(now, taskId);

  if (task.autoAccept) {
    const cheapest = db.prepare("SELECT * FROM bids WHERE taskId = ? AND status = 'pending' ORDER BY CAST(priceSats AS INTEGER) ASC LIMIT 1").get(taskId) as any;
    if (cheapest) {
      acceptBid(db, cheapest.id, taskId, cheapest.agentId, now);
      return res.status(201).json({ id, status: 'accepted', autoAccepted: true });
    }
  }
  res.status(201).json({ id, status: 'pending' });
});

router.post('/:id/accept', (req, res) => {
  const db = getDb();
  const bid = db.prepare(`SELECT * FROM bids WHERE id = ?`).get(req.params.id) as any;
  if (!bid) return res.status(404).json({ error: 'bid not found' });
  if (bid.status !== 'pending') return res.status(400).json({ error: 'bid not pending' });
  acceptBid(db, bid.id, bid.taskId, bid.agentId, Date.now());
  res.json({ bid: bid.id, status: 'accepted' });
});

function acceptBid(db: any, bidId: string, taskId: string, agentId: string, now: number) {
  db.prepare("UPDATE bids SET status = 'accepted' WHERE id = ?").run(bidId);
  db.prepare("UPDATE bids SET status = 'rejected' WHERE taskId = ? AND id != ? AND status = 'pending'").run(taskId, bidId);
  db.prepare("UPDATE tasks SET status = 'assigned', assignedAgentId = ?, updatedAt = ? WHERE id = ?").run(agentId, now, taskId);
  db.prepare("UPDATE escrows SET agentId = ? WHERE taskId = ?").run(agentId, taskId);
  db.prepare("UPDATE agents SET tasksAccepted = tasksAccepted + 1 WHERE id = ?").run(agentId);
}

router.get('/task/:taskId', (req, res) => {
  const db = getDb();
  const bids = db.prepare("SELECT b.*, a.name as agentName, a.reputation as agentReputation FROM bids b JOIN agents a ON b.agentId = a.id WHERE b.taskId = ? ORDER BY CAST(b.priceSats AS INTEGER) ASC").all(req.params.taskId);
  res.json(bids);
});

export default router;
