import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { getDb } from '../db/schema.js';
import { sanitize } from '../middleware/validate.js';
import { agentAuth } from '../middleware/auth.js';

const router = Router();

// Register a new agent (public)
router.post('/', (req, res) => {
  const { name, walletAddress } = req.body;
  if (!name || !walletAddress) return res.status(400).json({ error: 'name and walletAddress required' });
  if (name.length > 100) return res.status(400).json({ error: 'name too long' });

  const clean = sanitize(req.body, ['name', 'description']);
  const db = getDb();

  const existing = db.prepare("SELECT id FROM agents WHERE walletAddress = ?").get(walletAddress);
  if (existing) return res.status(409).json({ error: 'wallet already registered' });

  const id = uuid();
  const apiKey = `mm_${crypto.randomBytes(32).toString('hex')}`;
  const now = Date.now();
  const skills = Array.isArray(req.body.skills) ? req.body.skills.slice(0, 20) : [];

  db.prepare(`INSERT INTO agents (id, name, description, skills, walletAddress, apiKey, modelProvider, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, clean.name, clean.description || '', JSON.stringify(skills), walletAddress, apiKey, req.body.modelProvider || 'openrouter', now
  );

  res.status(201).json({ id, apiKey, name: clean.name, walletAddress });
});

// List agents (public leaderboard)
router.get('/', (req, res) => {
  const db = getDb();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const agents = db.prepare(`SELECT id, name, description, skills, reputation, tasksCompleted, tasksAccepted, totalEarned, modelProvider, createdAt FROM agents ORDER BY reputation DESC LIMIT ? OFFSET ?`).all(limit, offset);
  const total = (db.prepare("SELECT COUNT(*) as c FROM agents").get() as any).c;

  res.json({
    agents: agents.map((a: any) => ({ ...a, skills: JSON.parse(a.skills || '[]') })),
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

// Get agent by ID (public)
router.get('/:id', (req, res) => {
  const db = getDb();
  const agent = db.prepare(`SELECT id, name, description, skills, walletAddress, reputation, tasksCompleted, tasksAccepted, totalEarned, modelProvider, createdAt FROM agents WHERE id = ?`).get(req.params.id) as any;
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  agent.skills = JSON.parse(agent.skills || '[]');

  const recentTasks = db.prepare(`SELECT t.id, t.title, t.category, t.bountyWei, t.status, d.rating FROM tasks t LEFT JOIN deliverables d ON d.taskId = t.id AND d.agentId = ? WHERE t.assignedAgentId = ? ORDER BY t.updatedAt DESC LIMIT 10`).all(req.params.id, req.params.id);
  agent.recentTasks = recentTasks;
  res.json(agent);
});

// Update own agent profile (authed)
router.patch('/me', agentAuth, (req, res) => {
  const db = getDb();
  const agentId = (req as any).agentId;
  const clean = sanitize(req.body, ['name', 'description']);
  const updates: string[] = [];
  const params: any[] = [];

  if (clean.name) { updates.push('name = ?'); params.push(clean.name); }
  if (clean.description !== undefined) { updates.push('description = ?'); params.push(clean.description); }
  if (req.body.skills) { updates.push('skills = ?'); params.push(JSON.stringify(req.body.skills.slice(0, 20))); }
  if (req.body.modelProvider) { updates.push('modelProvider = ?'); params.push(req.body.modelProvider); }

  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  params.push(agentId);
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ updated: true });
});

export default router;
