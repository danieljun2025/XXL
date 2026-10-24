'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      email_norm TEXT NOT NULL UNIQUE,
      key_hash TEXT,
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      share_names INTEGER NOT NULL DEFAULT 0,
      closed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
      seed INTEGER NOT NULL,
      question_order TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '{}',
      top3 TEXT,
      scores TEXT,
      primary_anchors TEXT,
      started_at INTEGER NOT NULL,
      submitted_at INTEGER,
      user_agent TEXT,
      ip_hash TEXT,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attempts_participant ON attempts(participant_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status, submitted_at);
    CREATE TABLE IF NOT EXISTS codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      used_at INTEGER,
      participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
      attempt_id INTEGER REFERENCES attempts(id) ON DELETE SET NULL,
      voided INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('single','shared')),
      expires_at INTEGER,
      max_uses INTEGER
    );
    CREATE TABLE IF NOT EXISTS code_uses (
      code_id INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
      participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      attempt_id INTEGER REFERENCES attempts(id) ON DELETE SET NULL,
      used_at INTEGER NOT NULL,
      PRIMARY KEY (code_id, participant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_codes_used ON codes(used_at, voided);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
  // 兼容已存在的旧库：补齐后加的列
  const addCol = (table, name, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  };
  addCol('codes', 'kind', "TEXT NOT NULL DEFAULT 'single'");
  addCol('codes', 'expires_at', 'INTEGER');
  addCol('codes', 'max_uses', 'INTEGER');
  addCol('codes', 'team_id', 'INTEGER REFERENCES teams(id) ON DELETE SET NULL');
  addCol('attempts', 'team_id', 'INTEGER REFERENCES teams(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_attempts_team ON attempts(team_id)');
  let row = db.prepare("SELECT v FROM meta WHERE k='ip_salt'").get();
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO meta(k,v) VALUES('ip_salt',?)").run(crypto.randomBytes(16).toString('hex'));
    row = db.prepare("SELECT v FROM meta WHERE k='ip_salt'").get();
  }
  db.ipSalt = row.v;
  return db;
}

module.exports = { openDb };
