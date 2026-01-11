import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../data");
const dbPath = path.join(dataDir, "xylkit.db");

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

db.exec(`
  -- Deployments
  CREATE TABLE IF NOT EXISTS deployments (
    address TEXT PRIMARY KEY,
    network TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_tx_version TEXT
  );

  -- Sync cursors (tracks last indexed position)
  CREATE TABLE IF NOT EXISTS sync_cursors (
    deployment_address TEXT NOT NULL,
    event_type TEXT NOT NULL,
    last_sequence TEXT NOT NULL DEFAULT '0',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (deployment_address, event_type)
  );

  -- Sync metadata (tracks when last synced - for cooldown & UI freshness)
  CREATE TABLE IF NOT EXISTS sync_metadata (
    deployment_address TEXT PRIMARY KEY,
    last_synced_at TEXT NOT NULL,
    events_processed INTEGER NOT NULL DEFAULT 0,
    sync_duration_ms INTEGER NOT NULL DEFAULT 0,
    has_more INTEGER NOT NULL DEFAULT 0
  );

  -- Accounts
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_address TEXT NOT NULL,
    account_id TEXT NOT NULL,
    wallet_address TEXT,
    driver_type INTEGER NOT NULL DEFAULT 1,
    driver_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(deployment_address, account_id)
  );

  -- Streams
  CREATE TABLE IF NOT EXISTS streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_address TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    fa_metadata TEXT NOT NULL,
    amt_per_sec TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(deployment_address, sender_id, receiver_id, stream_id)
  );

  -- Splits
  CREATE TABLE IF NOT EXISTS splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_address TEXT NOT NULL,
    account_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    weight INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(deployment_address, account_id, receiver_id)
  );

  -- Events
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_address TEXT NOT NULL,
    event_type TEXT NOT NULL,
    account_id TEXT NOT NULL,
    data TEXT NOT NULL,
    tx_hash TEXT,
    sequence_number TEXT NOT NULL DEFAULT '0',
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Token prices (cached from CoinGecko)
  CREATE TABLE IF NOT EXISTS token_prices (
    token_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    price_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tokens metadata (cached from blockchain)
  CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_accounts_wallet ON accounts(wallet_address);
  CREATE INDEX IF NOT EXISTS idx_streams_sender ON streams(sender_id);
  CREATE INDEX IF NOT EXISTS idx_streams_receiver ON streams(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_splits_account ON splits(account_id);
  CREATE INDEX IF NOT EXISTS idx_events_account ON events(account_id);
  CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(deployment_address, event_type, sequence_number);
`);

// Add driver_name column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE accounts ADD COLUMN driver_name TEXT;`);
  console.log("✅ Added driver_name column to accounts table");
} catch (err: any) {
  if (!err.message.includes("duplicate column name")) {
    console.error("⚠️  Error adding driver_name column:", err.message);
  }
}

console.log("✅ Database migrated:", dbPath);
db.close();
