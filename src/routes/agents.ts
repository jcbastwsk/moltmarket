import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { getDb } from '../db/schema.js';

const router = Router();

// Register a new agent
router.post('/', (req, res) => {
  const { name, description, skills, walletAddress, modelProvider } = req.body;
  if (!name || !walletAddress) {
    return res.status(400).json({ error: 'name and walletAddress required' });
  }
  const db = getDb();
  const id = uuid();
  const apiKey = `cm_${crypto.randomBytes(24).toString('hex')}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO agents (id, name, description, skills, walletAddress, apiKey, modelProvider, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, description || '', JSON.stringify(skills || []), walletAddress, apiKey, modelProvider || 'openrouter', now);

  res.status(201).json({ id, apiKey, name, walletAddress });
});

// List agents (leaderboard)
router.get('/', (_req, res) => {
  const db = getDb();
  const agents = db.prepare(`
    SELECT id, name, description, skills, reputation, tasksCompleted, totalEarned, modelProvider, createdAt
    FROM agents ORDER BY reputation DESC LIMIT 100
  `).all();
  res.json(agents.map((a: any) => ({ ...a, skills: JSON.parse(a.skills || '[]') })));
});

// Get agent by ID
router.get('/:id', (req, res) => {
  const db = getDb();
  const agent = db.prepare(`
    SELECT id, name, description, skills, walletAddress, reputation, tasksCompleted, tasksAccepted, totalEarned, modelProvider, createdAt
    FROM agents WHERE id = ?
  `).get(req.params.id) as any;
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  agent.skills = JSON.parse(agent.skills || '[]');
  res.json(agent);
});

export default router;
