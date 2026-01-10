# Xylkit Indexer

Local indexer service for the Xylkit Explorer. Polls Movement/Aptos blockchain events and populates a SQLite database for the explorer UI.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Movement RPC   │────▶│  Local Indexer  │────▶│   SQLite DB     │
│  (blockchain)   │     │  (polls events) │     │   (local)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │   REST API      │
                                                │   (Express)     │
                                                └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │   Explorer UI   │
                                                │   (React)       │
                                                └─────────────────┘
```

## Local vs Production

This indexer is designed for **local development only**:

- **Local (INDEXER_ENABLED=true)**: Polls blockchain for events, stores in SQLite
- **Production (INDEXER_ENABLED=false)**: API-only mode, expects external data source

In production, you'd typically use:
- A hosted indexer service (e.g., Aptos Indexer, custom GraphQL)
- A production database (PostgreSQL, etc.)

## Setup

```bash
# Install dependencies
npm install

# Create database and tables
npm run db:migrate

# Copy environment config
cp .env.example .env
```

## Configuration

Edit `.env`:

```bash
# Server port
PORT=3001

# Environment
NODE_ENV=development

# Enable/disable local indexer
# true = polls blockchain (local dev)
# false = API-only mode (production)
INDEXER_ENABLED=true

# Movement/Aptos RPC endpoint
MOVEMENT_RPC_URL=https://aptos.testnet.porto.movementlabs.xyz/v1

# Xylkit deployment addresses to index (comma-separated)
KNOWN_DEPLOYMENTS=0xd18345e1db01a8d1dcd35348ff7fb00177fffde29a3afb50e23695d3ee34301f

# How often to poll for new events (ms)
INDEXER_POLL_INTERVAL=5000
```

## Running

```bash
# Development (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

## API Endpoints

### Deployments

| Endpoint | Description |
|----------|-------------|
| `GET /deployments` | List all known deployments with stats |
| `GET /deployments/:address` | Single deployment details |
| `GET /deployments/:address/streams` | All streams in deployment |
| `GET /deployments/:address/splits` | All splits configurations |
| `GET /deployments/:address/accounts` | All accounts |
| `GET /deployments/:address/events` | Activity feed |

### Users

| Endpoint | Description |
|----------|-------------|
| `GET /users/:address` | User data across all deployments |
| `GET /users/:address/deployments` | Which deployments user appears in |

### Health

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |

## Data Flow

1. **Indexer polls** Movement RPC for events from known deployments
2. **Events processed** and stored in SQLite:
   - `StreamsSet` → updates `streams` table
   - `SplitsSet` → updates `splits` table
   - `Given/Received/Squeezed/Collected` → stored in `events` table
3. **API serves** data to Explorer UI

## Database Schema

```sql
deployments (address, network, first_seen_at)
accounts (deployment_address, account_id, wallet_address, driver_type)
streams (deployment_address, sender_id, receiver_id, stream_id, ...)
splits (deployment_address, account_id, receiver_id, weight)
events (deployment_address, event_type, account_id, data, timestamp)
```

## Notes

- The indexer requires the contracts to emit events (StreamsSet, SplitsSet, etc.)
- Account IDs are derived from wallet addresses using the AddressDriver formula
- Balances (splittable, collectable, streaming) need to be fetched from chain view functions
