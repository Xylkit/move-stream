# Xylkit

Programmable token streaming and splitting for Movement blockchain.

## What is Xylkit?

Xylkit enables continuous payment flows on Movement:

- **Streaming** - Send tokens continuously over time at a fixed rate
- **Splitting** - Automatically distribute received funds among multiple recipients
- **Flexible Identity** - Use wallet addresses or NFTs to control accounts

## Project Structure

```
apps/
  contracts/movement/  # Move smart contracts
  docs/               # Web app (React + TanStack Router)
  server/             # Indexer API (Express + SQLite)
```

## Quick Start

### Deploy Contracts

```bash
cd apps/contracts/movement
aptos move publish --named-addresses xylkstream=default,movemate=default
```

### Run the Web App

```bash
cd apps/client
npm install
npm run dev
```

### Run the Indexer

```bash
cd apps/server
npm install
npm run dev
```

## How It Works

### Streaming

Create a stream to send tokens continuously:

- Set a rate (tokens per second)
- Optionally set duration
- Receiver can claim anytime

### Splitting

Configure how received funds are distributed:

- Set receivers with percentage weights
- Funds split automatically when claimed
- Keep a portion for yourself

### Account IDs

Each user has a 256-bit account ID:

- Driver ID (32 bits) - which driver controls the account
- Address/Token data (224 bits) - wallet address or NFT ID

## License

MIT

---

### Credits

Xylkit is inspired by and based on [Drips Protocol](https://drips.network) - the original streaming and splitting protocol on Ethereum.



# 1. Start local testnet

aptos node run-local-testnet --force-restart --assume-yes

# 2. Wait ~25 seconds for testnet to be ready

# 3. Initialize account (from apps/contracts/movement directory)

cd apps/contracts/movement
aptos init --network custom --rest-url http://127.0.0.1:8080 --faucet-url http://127.0.0.1:8081 --profile default --assume-yes

# 4. Deploy contracts

aptos move publish --named-addresses xylkstream=default,movemate=default --assume-yes --override-size-check --max-gas 200000 --gas-unit-price 100

# 5. Fund account

aptos account fund-with-faucet --account default --amount 5000000000000

# 6. Get private key (for tests)

cat .aptos/config.yaml | grep private_key

# 7. Run test (from apps/client directory)

cd ../../../apps/client
PRIVATE_KEY="0x<private-key-from-step-6>" npx tsx test.ts
