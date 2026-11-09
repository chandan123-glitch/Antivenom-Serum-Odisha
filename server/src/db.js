import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { DISTRICTS } from './districts.js';

export function openDb(dir = config.dataDir) {
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'asv.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS districts (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id              INTEGER PRIMARY KEY,
      district_id     INTEGER NOT NULL REFERENCES districts(id),
      is_current      INTEGER NOT NULL DEFAULT 0,
      report_date     TEXT NOT NULL,           -- "stock as on" date, YYYY-MM-DD
      letter_no       TEXT,
      notes           TEXT,
      source_name     TEXT NOT NULL,
      source_file     TEXT NOT NULL,
      letter_name     TEXT,
      letter_file     TEXT,
      facility_count  INTEGER NOT NULL,
      total_vials     INTEGER NOT NULL,
      warning_count   INTEGER NOT NULL DEFAULT 0,
      uploaded_by     TEXT NOT NULL,
      uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reports_district ON reports(district_id, is_current);
    -- at most one live report per district
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_current
      ON reports(district_id) WHERE is_current = 1;

    CREATE TABLE IF NOT EXISTS audit_log (
      id     INTEGER PRIMARY KEY,
      at     TEXT NOT NULL DEFAULT (datetime('now')),
      actor  TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT
    );
  `);

  migrateFacilities(db);

  const insert = db.prepare('INSERT OR IGNORE INTO districts (name, slug) VALUES (?, ?)');
  for (const d of DISTRICTS) insert.run(d.name, d.slug);
  return db;
}

// Unknown values are stored as NULL, never guessed: quantity, available, mo_available and
// service_24x7 are all nullable so a district can leave any of them out.
const FACILITIES_SQL = `
  CREATE TABLE facilities (
    id              INTEGER PRIMARY KEY,
    report_id       INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    district_id     INTEGER NOT NULL REFERENCES districts(id),
    sl_no           INTEGER,
    block           TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL DEFAULT '',
    name            TEXT NOT NULL,
    address         TEXT,
    lat             REAL,
    lng             REAL,
    quantity        INTEGER,              -- vials, NULL = not reported
    available       INTEGER,              -- 1 / 0, NULL = not reported
    mo_available    INTEGER,              -- trained doctor, NULL = not reported
    service_24x7    INTEGER,              -- NULL = not reported
    hours_note      TEXT,                 -- e.g. "9 AM to 5 PM" when not 24x7
    last_admin_date TEXT
  )`;

function migrateFacilities(db) {
  const cols = db.prepare('PRAGMA table_info(facilities)').all().map((c) => c.name);
  if (cols.length === 0) {
    db.exec(FACILITIES_SQL);
  } else if (!cols.includes('available')) {
    // upgrade from the first schema, where everything was mandatory
    db.exec('BEGIN');
    try {
      db.exec('ALTER TABLE facilities RENAME TO facilities_old');
      db.exec(FACILITIES_SQL);
      db.exec(`INSERT INTO facilities (id, report_id, district_id, sl_no, block, type, name, lat, lng, quantity, available,
                 mo_available, service_24x7, last_admin_date)
               SELECT id, report_id, district_id, sl_no, block, type, name, lat, lng, quantity, quantity > 0,
                 mo_available, service_24x7, last_admin_date FROM facilities_old`);
      db.exec('DROP TABLE facilities_old');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_fac_report ON facilities(report_id)');
}

/** Run fn inside a transaction; roll back on any throw. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db, actor, action, detail) {
  db.prepare('INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)').run(
    actor, action, detail ?? null
  );
}
