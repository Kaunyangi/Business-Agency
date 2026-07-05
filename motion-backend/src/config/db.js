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
  role TEXT NOT NULL DEFAULT 'buyer', -- buyer | organizer | host | admin
  phone TEXT NOT NULL DEFAULT '',
  terms_accepted_at TEXT,
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

CREATE TABLE IF NOT EXISTS bus_trips (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  coach_no TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  trip_date TEXT NOT NULL,
  departs_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  fare_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bus_seats (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES bus_trips(id),
  row_no INTEGER NOT NULL,
  letter TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' -- available | held | booked
);

CREATE TABLE IF NOT EXISTS sgr_trips (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL DEFAULT 'Kenya Railways',
  train_no TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  trip_date TEXT NOT NULL,
  departs_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  economy_fare_cents INTEGER NOT NULL,
  first_class_fare_cents INTEGER
);

CREATE TABLE IF NOT EXISTS sgr_seats (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES sgr_trips(id),
  row_no INTEGER NOT NULL,
  letter TEXT NOT NULL,
  cabin_class TEXT NOT NULL DEFAULT 'economy',
  status TEXT NOT NULL DEFAULT 'available' -- available | held | booked
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Villa', -- Villa | Resort | Boutique Resort | Airbnb | Lodge | Guesthouse | Other
  owner_id TEXT REFERENCES users(id) -- NULL for platform-seeded demo inventory; set for host-listed properties
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
  buyer_name TEXT,
  buyer_phone TEXT,
  buyer_email TEXT,
  buyer_id_number TEXT,
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

// Defensive column migration for databases created before country/type existed
// on properties — node:sqlite has no "ADD COLUMN IF NOT EXISTS", so we just
// swallow the error when the column is already there.
try { db.exec("ALTER TABLE properties ADD COLUMN country TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE properties ADD COLUMN type TEXT NOT NULL DEFAULT 'Villa'"); } catch (_) {}
try { db.exec("ALTER TABLE properties ADD COLUMN owner_id TEXT REFERENCES users(id)"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN terms_accepted_at TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE orders ADD COLUMN buyer_name TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE orders ADD COLUMN buyer_phone TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE orders ADD COLUMN buyer_email TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE orders ADD COLUMN buyer_id_number TEXT"); } catch (_) {}

module.exports = { db, transaction };
