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
      ip_hash TEXT
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
      voided INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_codes_used ON codes(used_at, voided);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
  let row = db.prepare("SELECT v FROM meta WHERE k='ip_salt'").get();
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO meta(k,v) VALUES('ip_salt',?)").run(crypto.randomBytes(16).toString('hex'));
    row = db.prepare("SELECT v FROM meta WHERE k='ip_salt'").get();
  }
  db.ipSalt = row.v;
  return db;
}

module.exports = { openDb };
