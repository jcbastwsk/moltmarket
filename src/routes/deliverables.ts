import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';

const router = Router();

router.post('/', (req, res) => {
  const { taskId, agentId, content, attachmentUrl } = req.body;
  if (!taskId || !agentId || !content) return res.status(400).json({ error: 'taskId, agentId, content required' });
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.assignedAgentId !== agentId) return res.status(403).json({ error: 'not assigned to this agent' });
  if (task.status !== 'assigned' && task.status !== 'in_progress') return res.status(400).json({ error: 'task not in assignable state' });
  const id = uuid();
  const now = Date.now();
  db.prepare("INSERT INTO deliverables (id, taskId, agentId, content, attachmentUrl, status, createdAt) VALUES (?, ?, ?, ?, ?, 'submitted', ?)").run(id, taskId, agentId, content, attachmentUrl || null, now);
  db.prepare("UPDATE tasks SET status = 'review', updatedAt = ? WHERE id = ?").run(now, taskId);
  res.status(201).json({ id, status: 'submitted' });
});

router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const { rating, reviewNotes } = req.body;
  const deliv = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(req.params.id) as any;
  if (!deliv) return res.status(404).json({ error: 'deliverable not found' });
  if (deliv.status !== 'submitted') return res.status(400).json({ error: 'not in submitted state' });
  const now = Date.now();
  const r = Math.max(1, Math.min(5, rating || 5));
  db.prepare("UPDATE deliverables SET status = 'approved', rating = ?, reviewNotes = ? WHERE id = ?").run(r, reviewNotes || null, req.params.id);
  db.prepare("UPDATE tasks SET status = 'completed', updatedAt = ? WHERE id = ?").run(now, deliv.taskId);
  db.prepare("UPDATE escrows SET status = 'released', releasedAt = ? WHERE taskId = ?").run(now, deliv.taskId);
  const escrow = db.prepare('SELECT amountWei FROM escrows WHERE taskId = ?').get(deliv.taskId) as any;
  const earned = BigInt(escrow?.amountWei || '0');
  db.prepare(`UPDATE agents SET tasksCompleted = tasksCompleted + 1, totalEarned = CAST((CAST(totalEarned AS INTEGER) + ?) AS TEXT), reputation = MIN(100, reputation + ? - 2.5) WHERE id = ?`).run(earned.toString(), r * 2, deliv.agentId);
  res.json({ id: req.params.id, status: 'approved', rating: r, escrow: 'released' });
});

router.post('/:id/reject', (req, res) => {
  const db = getDb();
  const { reviewNotes } = req.body;
  const deliv = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(req.params.id) as any;
  if (!deliv) return res.status(404).json({ error: 'deliverable not found' });
  const now = Date.now();
  db.prepare("UPDATE deliverables SET status = 'revision_requested', reviewNotes = ? WHERE id = ?").run(reviewNotes || 'Revision needed', req.params.id);
  db.prepare("UPDATE tasks SET status = 'in_progress', updatedAt = ? WHERE id = ?").run(now, deliv.taskId);
  res.json({ id: req.params.id, status: 'revision_requested' });
});

export default router;
