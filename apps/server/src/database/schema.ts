import { ColumnType, Generated } from 'kysely';

// Deployments table
export interface DeploymentsTable {
  address: string;
  network: string;
  first_seen_at: ColumnType<string, string, string>;
  last_tx_version: string | null;
}

// Sync cursors - tracks last indexed position per deployment
export interface SyncCursorsTable {
  deployment_address: string;
  event_type: string;
  last_sequence: string;
  updated_at: ColumnType<string, string, string>;
}

// Sync metadata - tracks when deployment was last synced
export interface SyncMetadataTable {
  deployment_address: string;
  last_synced_at: string;
  events_processed: number;
  sync_duration_ms: number;
  has_more: number; // SQLite boolean - 1 if more data to sync, 0 if complete
}

// Accounts table
export interface AccountsTable {
  id: Generated<number>;
  deployment_address: string;
  account_id: string;
  wallet_address: string | null;
  driver_type: number; // 1=AddressDriver, 2=NFTDriver
  created_at: ColumnType<string, string, string>;
}

// Streams table
export interface StreamsTable {
  id: Generated<number>;
  deployment_address: string;
  sender_id: string;
  receiver_id: string;
  stream_id: string;
  fa_metadata: string;
  amt_per_sec: string;
  start_time: number;
  duration: number;
  active: number; // SQLite boolean
  created_at: ColumnType<string, string, string>;
  updated_at: ColumnType<string, string, string>;
}

// Splits table
export interface SplitsTable {
  id: Generated<number>;
  deployment_address: string;
  account_id: string;
  receiver_id: string;
  weight: number;
  created_at: ColumnType<string, string, string>;
  updated_at: ColumnType<string, string, string>;
}

// Events table
export interface EventsTable {
  id: Generated<number>;
  deployment_address: string;
  event_type: string;
  account_id: string;
  data: string; // JSON string
  tx_hash: string | null;
  sequence_number: string; // For cursor tracking
  timestamp: ColumnType<string, string, string>;
}

// Token prices table - cached from CoinGecko
export interface TokenPricesTable {
  token_id: string; // e.g., '0xa' or coingecko id
  symbol: string;
  price_usd: number;
  updated_at: ColumnType<string, string, string>;
}

// Database interface
export interface DB {
  deployments: DeploymentsTable;
  sync_cursors: SyncCursorsTable;
  sync_metadata: SyncMetadataTable;
  accounts: AccountsTable;
  streams: StreamsTable;
  splits: SplitsTable;
  events: EventsTable;
  token_prices: TokenPricesTable;
}
