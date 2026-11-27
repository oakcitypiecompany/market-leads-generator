import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

export const DATA_DIR = new URL('../data/', import.meta.url).pathname;
mkdirSync(DATA_DIR, { recursive: true });

// Calendar date in Raleigh, so an evening post isn't dated the next day (UTC).
export const easternDay = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function openDb(path = DATA_DIR + 'leads.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      handle TEXT PRIMARY KEY,
      source TEXT NOT NULL,              -- follower | following | both
      status TEXT NOT NULL DEFAULT 'watched', -- watched | ignored | personal | private | missing
      last_checked INTEGER,              -- unix seconds of the last successful check
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS posts (
      shortcode TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      url TEXT NOT NULL,
      caption TEXT NOT NULL,
      taken_at INTEGER NOT NULL,         -- unix seconds
      is_video INTEGER NOT NULL,
      image_urls TEXT NOT NULL,          -- JSON array; video posts carry their thumbnail
      images TEXT NOT NULL DEFAULT '[]', -- JSON array of local file paths
      status TEXT NOT NULL DEFAULT 'new', -- new | skipped | extracted | error
      result TEXT                        -- extractor JSON
    );
  `);
  return db;
}
