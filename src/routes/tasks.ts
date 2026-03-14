import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { sanitize } from '../middleware/validate.js';

const VALID_STATUSES = ['open', 'bidding', 'assigned', 'in_progress', 'review', 'completed', 'disputed', 'cancelled'];
const VALID_CATEGORIES = ['coding', 'writing', 'research', 'data', 'design', 'general'];

const router = Router();

// Create a task
router.post('/', (req, res) => {
  const { clientId, title, description, bountyWei } = req.body;
  if (!clientId || !title || !description || !bountyWei) {
    return res.status(400).json({ error: 'clientId, title, description, bountyWei required' });
  }
  if (title.length > 200) return res.status(400).json({ error: 'title too long (max 200)' });

  const clean = sanitize(req.body, ['title', 'description', 'acceptanceCriteria']);
  const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : 'general';
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const deadline = Number(req.body.deadline) || now + 86400000;
  const maxBids = Math.min(50, Math.max(1, Number(req.body.maxBids) || 10));

  db.prepare("INSERT INTO tasks (id, clientId, title, description, category, bountyWei, deadline, acceptanceCriteria, maxBids, autoAccept, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)").run(
    id, clientId, clean.title, clean.description, category, bountyWei, deadline, clean.acceptanceCriteria || '', maxBids, req.body.autoAccept ? 1 : 0, now, now
  );

  const escrowId = uuid();
  db.prepare("INSERT INTO escrows (id, taskId, clientId, amountWei, status, createdAt) VALUES (?, ?, ?, ?, 'funded', ?)").run(escrowId, id, clientId, bountyWei, now);

  res.status(201).json({ id, escrowId, title: clean.title, status: 'open', category, bountyWei });
});

// List tasks with filters and pagination
router.get('/', (req, res) => {
  const db = getDb();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const { category, status, q, sort } = req.query;

  let sql = 'SELECT * FROM tasks WHERE 1=1';
  let countSql = 'SELECT COUNT(*) as c FROM tasks WHERE 1=1';
  const params: any[] = [];
  const countParams: any[] = [];

  if (status && VALID_STATUSES.includes(status as string)) {
    sql += ' AND status = ?'; countSql += ' AND status = ?';
    params.push(status); countParams.push(status);
  } else if (!status) {
    sql += " AND status IN ('open', 'bidding')";
    countSql += " AND status IN ('open', 'bidding')";
  }
  if (category && VALID_CATEGORIES.includes(category as string)) {
    sql += ' AND category = ?'; countSql += ' AND category = ?';
    params.push(category); countParams.push(category);
  }
  if (q) {
    sql += ' AND (title LIKE ? OR description LIKE ?)';
    countSql += ' AND (title LIKE ? OR description LIKE ?)';
    const like = `%${(q as string).slice(0, 100)}%`;
    params.push(like, like); countParams.push(like, like);
  }

  const sortField = sort === 'bounty' ? 'CAST(bountyWei AS INTEGER) DESC' : sort === 'deadline' ? 'deadline ASC' : 'createdAt DESC';
  sql += ` ORDER BY ${sortField} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const total = (db.prepare(countSql).get(...countParams) as any).c;
  const tasks = db.prepare(sql).all(...params);

  res.json({ tasks, page, limit, total, pages: Math.ceil(total / limit) });
});

// Get task detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'task not found' });

  const bids = db.prepare("SELECT b.*, a.name as agentName, a.reputation as agentReputation FROM bids b JOIN agents a ON b.agentId = a.id WHERE b.taskId = ? ORDER BY CAST(b.priceWei AS INTEGER) ASC").all(req.params.id);
  const deliverables = db.prepare('SELECT * FROM deliverables WHERE taskId = ? ORDER BY createdAt DESC').all(req.params.id);
  const escrow = db.prepare('SELECT * FROM escrows WHERE taskId = ?').get(req.params.id);

  res.json({ ...task, bids, deliverables, escrow });
});

// Cancel task
router.post('/:id/cancel', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status !== 'open' && task.status !== 'bidding') {
    return res.status(400).json({ error: 'can only cancel open/bidding tasks' });
  }
  const now = Date.now();
  db.prepare("UPDATE tasks SET status = 'cancelled', updatedAt = ? WHERE id = ?").run(now, req.params.id);
  db.prepare("UPDATE escrows SET status = 'refunded' WHERE taskId = ?").run(req.params.id);
  db.prepare("UPDATE bids SET status = 'rejected' WHERE taskId = ? AND status = 'pending'").run(req.params.id);
  res.json({ id: req.params.id, status: 'cancelled' });
});

export default router;
