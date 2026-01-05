# Xylkit Interactive Documentation

Interactive documentation and UI for the Xylkit protocol - Drips streaming payments on Aptos.

## Features

- **Streams**: Create and manage continuous payment streams
- **Splits**: Configure automatic fund splitting to multiple recipients
- **Give**: Send one-time token transfers
- **Accounts**: Manage address-based and NFT-based accounts
- **Live Cycle Indicator**: Real-time display of current cycle and countdown
- **Code Examples**: Copy-paste ready code snippets for all operations

## Tech Stack

- React 19 + TypeScript
- Vite for build tooling
- Radix UI primitives
- shadcn/ui components
- Tailwind CSS 4
- @aptos-labs/ts-sdk for blockchain interaction

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Usage

1. Make sure localnet is running:
```bash
cd ../contract
aptos node run-localnet --with-faucet --force-restart
```

2. Deploy contracts (if not already deployed):
```bash
aptos move publish --named-addresses xylkit=default --skip-fetch-latest-git-deps --assume-yes --language-version 2.3 --max-gas 500000
```

3. Start the docs app:
```bash
npm run dev
```

4. Open http://localhost:5173

## Structure

```
src/
├── components/
│   ├── ui/              # shadcn components (Button, Card, etc.)
│   ├── layout/          # Layout components (Header, Layout)
│   ├── CycleIndicator   # Live cycle countdown
│   └── CodeBlock        # Code snippet display
├── pages/
│   ├── Home             # Landing page
│   ├── Streams          # Stream management
│   ├── Splits           # Split configuration
│   ├── Give             # One-time transfers
│   └── Accounts         # Account management
├── lib/
│   ├── aptos.ts         # Aptos SDK setup
│   ├── constants.ts     # Contract addresses
│   └── utils.ts         # Utility functions
└── App.tsx              # Main app with routing
```

## Next Steps

- [ ] Implement wallet connection (Petra/Martian)
- [ ] Add real contract interactions
- [ ] Add transaction status toasts
- [ ] Add stream visualization
- [ ] Add balance queries
- [ ] Add transaction history
- [ ] Deploy to testnet
