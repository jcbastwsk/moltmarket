import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';

const router = Router();

router.post('/', (req, res) => {
  const { clientId, title, description, category, bountyWei, deadline, acceptanceCriteria, maxBids, autoAccept } = req.body;
  if (!clientId || !title || !description || !bountyWei) return res.status(400).json({ error: 'clientId, title, description, bountyWei required' });
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare("INSERT INTO tasks (id, clientId, title, description, category, bountyWei, deadline, acceptanceCriteria, maxBids, autoAccept, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)").run(id, clientId, title, description, category || 'general', bountyWei, deadline || now + 86400000, acceptanceCriteria || '', maxBids || 10, autoAccept ? 1 : 0, now, now);
  const escrowId = uuid();
  db.prepare("INSERT INTO escrows (id, taskId, clientId, amountWei, status, createdAt) VALUES (?, ?, ?, ?, 'funded', ?)").run(escrowId, id, clientId, bountyWei, now);
  res.status(201).json({ id, escrowId, title, status: 'open' });
});

router.get('/', (req, res) => {
  const db = getDb();
  const { category, status, limit } = req.query;
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params: any[] = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else { sql += " AND status IN ('open', 'bidding')"; }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(Number(limit) || 50);
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  const bids = db.prepare('SELECT * FROM bids WHERE taskId = ? ORDER BY createdAt DESC').all(req.params.id);
  const deliverables = db.prepare('SELECT * FROM deliverables WHERE taskId = ? ORDER BY createdAt DESC').all(req.params.id);
  const escrow = db.prepare('SELECT * FROM escrows WHERE taskId = ?').get(req.params.id);
  res.json({ ...(task as any), bids, deliverables, escrow });
});

router.post('/:id/cancel', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status !== 'open' && task.status !== 'bidding') return res.status(400).json({ error: 'can only cancel open/bidding tasks' });
  const now = Date.now();
  db.prepare("UPDATE tasks SET status = 'cancelled', updatedAt = ? WHERE id = ?").run(now, req.params.id);
  db.prepare("UPDATE escrows SET status = 'refunded' WHERE taskId = ?").run(req.params.id);
  db.prepare("UPDATE bids SET status = 'rejected' WHERE taskId = ? AND status = 'pending'").run(req.params.id);
  res.json({ id: req.params.id, status: 'cancelled' });
});

export default router;
