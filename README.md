# Xylkit - Drips Protocol on Aptos

A Move implementation of the Drips protocol for the Aptos blockchain. Xylkit enables programmable token streaming and splitting, allowing users to create continuous payment flows and distribute funds among multiple recipients.

## Overview

Xylkit is a port of the Drips protocol to Aptos, providing:

- Token streaming with configurable rates and durations
- Splits for distributing received funds among multiple recipients
- Multiple identity drivers (address-based and NFT-based)
- Efficient cycle-based accounting for gas optimization

## Project Structure

```
apps/
  contract/           # Move smart contracts
    sources/
      drips.move              # Core protocol module
      streams.move            # Token streaming logic
      splits.move             # Fund splitting logic
      address_driver.move     # Address-based identity driver
      nft_driver.move         # NFT-based identity driver
      driver_transfer_utils.move  # Token transfer utilities
    sources/tests/            # Contract tests
  docs/               # Documentation site (React + TanStack Router)
```

## Smart Contracts

### Core Modules

**drips.move** - The main entry point that coordinates streams and splits. Manages protocol-wide token balances and provides the public API for drivers.

**streams.move** - Implements continuous token streaming with:
- Configurable streaming rates (amt_per_sec)
- Start times and durations
- Cycle-based accounting for efficient receiving
- Squeeze functionality for early fund access

**splits.move** - Handles fund distribution:
- Configurable split receivers with weights
- Splittable and collectable balance tracking
- Automatic distribution when splitting

### Identity Drivers

**address_driver.move** - Simple address-based identity where each wallet address maps to a unique account ID. No registration required.

**nft_driver.move** - NFT-based identity where token ownership controls the account. Supports:
- Sequential minting
- Deterministic minting with salt
- Token burning to freeze accounts

**driver_transfer_utils.move** - Shared utilities for token transfers between user wallets and the protocol vault.

## Key Concepts

### Account IDs
256-bit identifiers composed of:
- Driver ID (32 bits) - identifies which driver controls the account
- Driver-specific data (224 bits) - address bits or token counter

### Streaming
Funds flow continuously from sender to receivers at a specified rate. Receivers can:
- Wait for cycles to complete and call `receive_streams`
- Squeeze funds early from the current cycle

### Splitting
Received funds go through a split phase before collection:
1. Funds arrive as "splittable"
2. Calling `split` distributes to receivers based on weights
3. Remainder becomes "collectable"
4. Calling `collect` withdraws to wallet

### Cycles
Time is divided into cycles (default 5 minutes). Streaming accounting happens per-cycle for gas efficiency.

## Development

### Prerequisites

- Aptos CLI
- Move compiler

### Building

```bash
cd apps/contract
aptos move compile
```

### Testing

```bash
cd apps/contract
aptos move test
```

### Local Deployment

```bash
cd apps/contract
aptos move publish --named-addresses xylkit=default
```

After publishing, initialize the drivers:

```bash
# Initialize address driver with driver_id 0
aptos move run --function-id 'xylkit::address_driver::initialize' --args u32:0

# Initialize NFT driver with driver_id 1
aptos move run --function-id 'xylkit::nft_driver::initialize' --args u32:1
```

## Documentation Site

The `apps/docs` directory contains a React-based documentation site built with:
- TanStack Router for routing
- Tailwind CSS for styling
- Radix UI components
- Aptos Wallet Adapter for wallet integration

### Running the docs site

```bash
cd apps/docs
npm install
npm run dev
```

## License

MIT
