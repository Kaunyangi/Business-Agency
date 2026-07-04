// src/config/db.js
// -----------------------------------------------------------------------
// Persistence layer. Uses Node's built-in `node:sqlite` (real SQL, ACID
// transactions, prepared statements — no ORM magic hiding what's happening).
//
// To move to Postgres/MySQL in production: everything in this file is the
// only place that touches the driver. Swap DatabaseSync for a pg/mysql2
// pool here and the rest of the app (which only calls db.prepare/exec/
// transaction) does not need to change, as long as the adapter below keeps
// the same shape.
// -----------------------------------------------------------------------
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'motion.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Minimal transaction helper — node:sqlite has no built-in .transaction()
// like better-sqlite3, so we wrap BEGIN/COMMIT/ROLLBACK ourselves and make
// sure a failure never leaves half-applied money movements committed.
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer', -- buyer | organizer | admin
  wallet_balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,             -- topup | debit | credit | payout
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT,
  venue TEXT,
  city TEXT,
  event_date TEXT,
  gate_time TEXT,
  description TEXT,
  poster_data_url TEXT,           -- data: URL for demo; production -> object storage URL
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_tiers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  quantity_total INTEGER NOT NULL,
  quantity_sold INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  airline TEXT NOT NULL,
  flight_no TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  flight_date TEXT NOT NULL,
  departs_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  economy_fare_cents INTEGER NOT NULL,
  business_fare_cents INTEGER
);

CREATE TABLE IF NOT EXISTS flight_seats (
  id TEXT PRIMARY KEY,
  flight_id TEXT NOT NULL REFERENCES flights(id),
  row_no INTEGER NOT NULL,
  letter TEXT NOT NULL,
  cabin_class TEXT NOT NULL DEFAULT 'economy',
  status TEXT NOT NULL DEFAULT 'available' -- available | held | booked
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  tags TEXT -- json array
);

CREATE TABLE IF NOT EXISTS room_bookings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  order_id TEXT NOT NULL,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  guests INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  order_type TEXT NOT NULL,       -- ticket | flight | stay
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | refunded
  subtotal_cents INTEGER NOT NULL,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  fees_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  ref_type TEXT NOT NULL,
  ref_id TEXT,
  description TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,          -- mpesa | card | wallet
  provider_ref TEXT,
  status TEXT NOT NULL,            -- success | failed
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commission_rules (
  rule_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  applies_to TEXT NOT NULL,        -- ticket | flight | stay
  rate_percent REAL NOT NULL DEFAULT 0,
  flat_fee_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revenue_ledger (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  rule_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  doc_type TEXT NOT NULL,          -- receipt | invoice
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  meta_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(SCHEMA);

module.exports = { db, transaction };
