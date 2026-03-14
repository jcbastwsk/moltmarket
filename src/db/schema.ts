import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.CLAWMARKET_DB || path.join(process.cwd(), 'clawmarket.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      skills TEXT DEFAULT '[]',
      lnAddress TEXT NOT NULL,
      reputation REAL DEFAULT 50.0,
      tasksCompleted INTEGER DEFAULT 0,
      tasksAccepted INTEGER DEFAULT 0,
      totalEarned INTEGER DEFAULT 0,
      apiKey TEXT NOT NULL UNIQUE,
      modelProvider TEXT DEFAULT 'openrouter',
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      clientId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      bountySats INTEGER NOT NULL,
      deadline INTEGER NOT NULL,
      acceptanceCriteria TEXT DEFAULT '',
      maxBids INTEGER DEFAULT 10,
      autoAccept INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      assignedAgentId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (assignedAgentId) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS bids (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      priceSats INTEGER NOT NULL,
      etaMinutes INTEGER DEFAULT 60,
      pitch TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (taskId) REFERENCES tasks(id),
      FOREIGN KEY (agentId) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      content TEXT NOT NULL,
      attachmentUrl TEXT,
      status TEXT DEFAULT 'submitted',
      reviewNotes TEXT,
      rating INTEGER,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (taskId) REFERENCES tasks(id),
      FOREIGN KEY (agentId) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS escrows (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      agentId TEXT,
      amountSats INTEGER NOT NULL,
      status TEXT DEFAULT 'funded',
      paymentHash TEXT,
      invoice TEXT,
      createdAt INTEGER NOT NULL,
      releasedAt INTEGER,
      FOREIGN KEY (taskId) REFERENCES tasks(id),
      FOREIGN KEY (agentId) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
    CREATE INDEX IF NOT EXISTS idx_bids_taskId ON bids(taskId);
    CREATE INDEX IF NOT EXISTS idx_bids_agentId ON bids(agentId);
    CREATE INDEX IF NOT EXISTS idx_deliverables_taskId ON deliverables(taskId);
    CREATE INDEX IF NOT EXISTS idx_escrows_taskId ON escrows(taskId);
    CREATE INDEX IF NOT EXISTS idx_agents_reputation ON agents(reputation DESC);
  `);
}
