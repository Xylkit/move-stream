# Xylkit UI Implementation

## What We Built

An interactive documentation and UI for the Xylkit protocol (Drips on Aptos) with actionable examples and live demonstrations.

## Architecture

### Design Philosophy
- **Not a stepper**: Each section is independent and fully functional
- **Documentation + Action**: Every page explains concepts AND lets you do them
- **Live feedback**: Real-time cycle countdown, visual stream flows
- **Code-first**: Copy-paste ready examples for developers

### Tech Stack
- React 19 + TypeScript
- Radix UI primitives (Accordion, Dialog, Tabs, etc.)
- shadcn/ui component patterns
- Tailwind CSS 4 with custom design tokens
- @aptos-labs/ts-sdk for blockchain interaction
- Vite for fast development

## Pages & Features

### 1. Home (`/`)
- Overview of Xylkit capabilities
- Quick start guide (4 steps)
- Live cycle indicator
- Feature cards linking to each section
- Protocol explanation (cycles, collect, drivers)

### 2. Streams (`/streams`)
**Tabs:**
- **Create Stream**: Form to set up new streams with live visualizer
- **Active Streams**: View outgoing/incoming streams
- **Code Examples**: TypeScript SDK snippets

**Features:**
- Stream flow visualization with real-time calculations
- Amount per second/cycle/hour/day breakdown
- Visual sender → receiver flow diagram
- Form validation (min amount per second)

### 3. Splits (`/splits`)
**Tabs:**
- **Configure Splits**: Add/remove recipients with percentages
- **Code Examples**: SDK implementation

**Features:**
- Dynamic recipient list (add/remove)
- Real-time percentage total validation
- Visual feedback (green when 100%, red otherwise)
- Up to 200 recipients support

### 4. Give (`/give`)
**Tabs:**
- **Send Tokens**: One-time transfer form
- **Code Examples**: SDK snippets

**Features:**
- Simple transfer interface
- Give vs Stream comparison
- Transaction history placeholder
- Batch give examples

### 5. Accounts (`/accounts`)
**Tabs:**
- **Overview**: Driver system explanation
- **Address Driver**: Wallet-based accounts
- **NFT Driver**: NFT-based sub-accounts
- **Code Examples**: Account ID calculation, NFT minting

**Features:**
- Driver comparison cards
- Account type explanations
- Use case recommendations
- NFT account management

## Components

### UI Components (shadcn)
- `Button`: Primary actions
- `Card`: Content containers
- `Input`: Form fields
- `Label`: Form labels
- `Tabs`: Section navigation

### Custom Components
- `CycleIndicator`: Live cycle countdown (updates every second)
- `StreamVisualizer`: Visual stream flow with calculations
- `CodeBlock`: Syntax-highlighted code snippets
- `QuickStart`: Step-by-step guide
- `StatusBadge`: Connection status indicator
- `Header`: Navigation with wallet connect
- `Layout`: Page wrapper

## Utilities

### `lib/aptos.ts`
- Aptos SDK configuration for localnet
- `getCurrentCycle()`: Calculate current cycle number
- `getTimeRemainingInCycle()`: Countdown timer
- `formatAPT()`: Convert Octas to APT

### `lib/constants.ts`
- Contract address
- Node URL
- Cycle configuration
- Min amount per second

### `lib/utils.ts`
- `cn()`: Tailwind class merging utility

## Styling

### Design System
- Custom CSS variables for theming
- Light/dark mode support
- Consistent spacing and typography
- Color-coded sections (blue=streams, green=splits, purple=give, orange=accounts)

### Responsive Design
- Mobile-first approach
- Grid layouts for feature cards
- Flexible forms and inputs
- Sticky header navigation

## Next Steps (Not Implemented)

### Wallet Integration
- [ ] Petra wallet adapter
- [ ] Martian wallet adapter
- [ ] Account connection state
- [ ] Balance queries

### Contract Interactions
- [ ] Real transaction submissions
- [ ] Transaction status tracking
- [ ] Error handling & user feedback
- [ ] Gas estimation

### Data Fetching
- [ ] Query active streams
- [ ] Query split configurations
- [ ] Query collectable balances
- [ ] Transaction history

### Enhanced Features
- [ ] Stream editing/cancellation
- [ ] Batch operations
- [ ] Transaction simulation
- [ ] Export/import configurations
- [ ] Notification system

## Development

```bash
# Install
npm install

# Dev server (http://localhost:5173)
npm run dev

# Build
npm run build

# Preview production build
npm run preview
```

## File Structure

```
apps/docs/
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   └── tabs.tsx
│   │   ├── layout/
│   │   │   ├── Header.tsx         # Navigation + wallet
│   │   │   └── Layout.tsx         # Page wrapper
│   │   ├── CodeBlock.tsx          # Code snippets
│   │   ├── CycleIndicator.tsx     # Live countdown
│   │   ├── QuickStart.tsx         # Getting started
│   │   ├── StatusBadge.tsx        # Status indicator
│   │   └── StreamVisualizer.tsx   # Stream flow viz
│   ├── pages/
│   │   ├── Home.tsx               # Landing page
│   │   ├── Streams.tsx            # Stream management
│   │   ├── Splits.tsx             # Split config
│   │   ├── Give.tsx               # One-time transfers
│   │   └── Accounts.tsx           # Account management
│   ├── lib/
│   │   ├── aptos.ts               # SDK setup
│   │   ├── constants.ts           # Config
│   │   └── utils.ts               # Helpers
│   ├── App.tsx                    # Router
│   ├── main.tsx                   # Entry point
│   └── index.css                  # Global styles
├── public/
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

## Key Design Decisions

1. **Simple Client-Side Routing**: No heavy router library, just state-based navigation
2. **Component Composition**: Radix primitives + custom logic = flexible UI
3. **Type Safety**: Full TypeScript with strict mode
4. **Performance**: Minimal re-renders, efficient state updates
5. **Developer Experience**: Clear code structure, reusable components
6. **User Experience**: Immediate feedback, clear CTAs, helpful explanations

## Testing Locally

1. Start localnet:
```bash
cd apps/contract
aptos node run-localnet --with-faucet --force-restart
```

2. Deploy contracts:
```bash
aptos move publish --named-addresses xylkit=default --skip-fetch-latest-git-deps --assume-yes --language-version 2.3 --max-gas 500000
```

3. Start UI:
```bash
cd apps/docs
npm run dev
```

4. Open http://localhost:5173

The UI is fully functional for exploration and learning. Wallet integration and real transactions are the next implementation phase.
