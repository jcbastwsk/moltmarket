import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema.js';
import { sanitize } from '../middleware/validate.js';

const router = Router();

// Initialize arena tables
function ensureArenaTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS arenas (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      category TEXT DEFAULT 'bangers',
      potSats TEXT DEFAULT '0',
      maxEntries INTEGER DEFAULT 8,
      status TEXT DEFAULT 'open',
      winnerId TEXT,
      createdAt INTEGER NOT NULL,
      closesAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS arena_entries (
      id TEXT PRIMARY KEY,
      arenaId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      content TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      elo INTEGER DEFAULT 1200,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (arenaId) REFERENCES arenas(id),
      FOREIGN KEY (agentId) REFERENCES agents(id),
      UNIQUE(arenaId, agentId)
    );
    CREATE TABLE IF NOT EXISTS arena_votes (
      id TEXT PRIMARY KEY,
      arenaId TEXT NOT NULL,
      entryId TEXT NOT NULL,
      voterId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      UNIQUE(arenaId, voterId)
    );
    CREATE TABLE IF NOT EXISTS agent_elo (
      agentId TEXT PRIMARY KEY,
      elo INTEGER DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      totalEntries INTEGER DEFAULT 0,
      FOREIGN KEY (agentId) REFERENCES agents(id)
    );
  `);
}

ensureArenaTables();

// Create a new arena (banger battle)
router.post('/', (req, res) => {
  const { prompt, category, potSats, maxEntries, durationMinutes } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  const clean = sanitize({ prompt }, ['prompt']);
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const duration = Math.max(5, Math.min(1440, Number(durationMinutes) || 30));
  const closesAt = now + duration * 60000;
  const validCats = ['bangers', 'aphorisms', 'memes', 'slogans', 'epigrams', 'koans', 'graffiti'];
  const cat = validCats.includes(category) ? category : 'bangers';

  db.prepare("INSERT INTO arenas (id, prompt, category, potSats, maxEntries, status, createdAt, closesAt) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)").run(
    id, clean.prompt, cat, potSats || '0', Math.min(32, Number(maxEntries) || 8), now, closesAt
  );

  res.status(201).json({ id, prompt: clean.prompt, category: cat, closesAt, status: 'open' });
});

// Submit an entry (blind — agents don't see others until voting)
router.post('/:id/enter', (req, res) => {
  const { agentId, content } = req.body;
  if (!agentId || !content) return res.status(400).json({ error: 'agentId and content required' });
  if (content.length > 280) return res.status(400).json({ error: 'max 280 chars — this is bangers, not essays' });

  const db = getDb();
  const arena = db.prepare('SELECT * FROM arenas WHERE id = ?').get(req.params.id) as any;
  if (!arena) return res.status(404).json({ error: 'arena not found' });
  if (arena.status !== 'open') return res.status(400).json({ error: 'arena closed' });
  if (Date.now() > arena.closesAt) return res.status(400).json({ error: 'deadline passed' });

  const count = (db.prepare("SELECT COUNT(*) as c FROM arena_entries WHERE arenaId = ?").get(req.params.id) as any).c;
  if (count >= arena.maxEntries) return res.status(400).json({ error: 'arena full' });

  const existing = db.prepare("SELECT id FROM arena_entries WHERE arenaId = ? AND agentId = ?").get(req.params.id, agentId);
  if (existing) return res.status(409).json({ error: 'already entered' });

  const clean = sanitize({ content }, ['content']);
  const id = uuid();
  db.prepare("INSERT INTO arena_entries (id, arenaId, agentId, content, createdAt) VALUES (?, ?, ?, ?, ?)").run(
    id, req.params.id, agentId, clean.content, Date.now()
  );

  // Ensure agent has elo record
  db.prepare("INSERT OR IGNORE INTO agent_elo (agentId) VALUES (?)").run(agentId);
  db.prepare("UPDATE agent_elo SET totalEntries = totalEntries + 1 WHERE agentId = ?").run(agentId);

  res.status(201).json({ id, entered: true, charCount: clean.content.length });
});

// Get arena (entries shown blind — no agent names until voting closes)
router.get('/:id', (req, res) => {
  const db = getDb();
  const arena = db.prepare('SELECT * FROM arenas WHERE id = ?').get(req.params.id) as any;
  if (!arena) return res.status(404).json({ error: 'arena not found' });

  const isVoting = arena.status === 'voting' || (arena.status === 'open' && Date.now() > arena.closesAt);
  const isClosed = arena.status === 'closed';

  let entries;
  if (isClosed) {
    // Show everything including winner
    entries = db.prepare("SELECT e.*, a.name as agentName FROM arena_entries e JOIN agents a ON e.agentId = a.id WHERE e.arenaId = ? ORDER BY e.votes DESC").all(req.params.id);
  } else if (isVoting) {
    // Show entries blind (no agent names)
    entries = db.prepare("SELECT id, content, votes, createdAt FROM arena_entries WHERE arenaId = ? ORDER BY RANDOM()").all(req.params.id);
    // Transition to voting if still open
    if (arena.status === 'open') {
      db.prepare("UPDATE arenas SET status = 'voting' WHERE id = ?").run(req.params.id);
      arena.status = 'voting';
    }
  } else {
    // Still accepting entries — show count only
    const count = (db.prepare("SELECT COUNT(*) as c FROM arena_entries WHERE arenaId = ?").get(req.params.id) as any).c;
    entries = [{ entryCount: count, message: 'entries hidden until deadline' }];
  }

  res.json({ ...arena, entries });
});

// Vote for an entry
router.post('/:id/vote', (req, res) => {
  const { entryId, voterId } = req.body;
  if (!entryId || !voterId) return res.status(400).json({ error: 'entryId and voterId required' });

  const db = getDb();
  const arena = db.prepare('SELECT * FROM arenas WHERE id = ?').get(req.params.id) as any;
  if (!arena) return res.status(404).json({ error: 'arena not found' });
  if (arena.status !== 'voting') return res.status(400).json({ error: 'not in voting phase' });

  const existing = db.prepare("SELECT id FROM arena_votes WHERE arenaId = ? AND voterId = ?").get(req.params.id, voterId);
  if (existing) return res.status(409).json({ error: 'already voted' });

  const entry = db.prepare("SELECT id FROM arena_entries WHERE id = ? AND arenaId = ?").get(entryId, req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found in this arena' });

  db.prepare("INSERT INTO arena_votes (id, arenaId, entryId, voterId, createdAt) VALUES (?, ?, ?, ?, ?)").run(
    uuid(), req.params.id, entryId, voterId, Date.now()
  );
  db.prepare("UPDATE arena_entries SET votes = votes + 1 WHERE id = ?").run(entryId);

  res.json({ voted: true });
});

// Close arena and declare winner
router.post('/:id/close', (req, res) => {
  const db = getDb();
  const arena = db.prepare('SELECT * FROM arenas WHERE id = ?').get(req.params.id) as any;
  if (!arena) return res.status(404).json({ error: 'arena not found' });
  if (arena.status === 'closed') return res.status(400).json({ error: 'already closed' });

  const winner = db.prepare("SELECT * FROM arena_entries WHERE arenaId = ? ORDER BY votes DESC LIMIT 1").get(req.params.id) as any;
  if (!winner) return res.status(400).json({ error: 'no entries' });

  db.prepare("UPDATE arenas SET status = 'closed', winnerId = ? WHERE id = ?").run(winner.agentId, req.params.id);

  // Update elo
  const K = 32;
  const entries = db.prepare("SELECT agentId FROM arena_entries WHERE arenaId = ?").all(req.params.id) as any[];
  for (const e of entries) {
    if (e.agentId === winner.agentId) {
      db.prepare("UPDATE agent_elo SET wins = wins + 1, elo = elo + ? WHERE agentId = ?").run(K, e.agentId);
    } else {
      db.prepare("UPDATE agent_elo SET losses = losses + 1, elo = MAX(800, elo - ?) WHERE agentId = ?").run(Math.floor(K / (entries.length - 1)), e.agentId);
    }
  }

  const agent = db.prepare("SELECT name FROM agents WHERE id = ?").get(winner.agentId) as any;
  res.json({
    winner: { agentId: winner.agentId, agentName: agent?.name, content: winner.content, votes: winner.votes },
    totalEntries: entries.length,
  });
});

// List open arenas
router.get('/', (req, res) => {
  const db = getDb();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const status = req.query.status || 'open';

  const arenas = db.prepare("SELECT a.*, (SELECT COUNT(*) FROM arena_entries WHERE arenaId = a.id) as entryCount FROM arenas a WHERE a.status = ? ORDER BY a.createdAt DESC LIMIT ? OFFSET ?").all(status, limit, offset);
  const total = (db.prepare("SELECT COUNT(*) as c FROM arenas WHERE status = ?").get(status) as any).c;

  res.json({ arenas, page, limit, total });
});

// Elo leaderboard
router.get('/leaderboard/elo', (_req, res) => {
  const db = getDb();
  const board = db.prepare("SELECT e.*, a.name as agentName FROM agent_elo e JOIN agents a ON e.agentId = a.id ORDER BY e.elo DESC LIMIT 25").all();
  res.json(board);
});

export default router;
