# Comprehensive Xylkit Drips Protocol Test

This test demonstrates all major functionality of the Drips protocol including streams, gives, withdrawals, splits, and both Address Driver and NFT Driver operations.

## Test Coverage

### Address Driver Tests
1. **Set Streams** - Create a continuous stream to a receiver
2. **Give** - Direct one-time transfer to a receiver  
3. **Set Splits** - Configure how received funds are split
4. **Collect** - Collect received streams and split funds
5. **Withdraw** - Withdraw funds from an active stream

### NFT Driver Tests
6. **Mint Token** - Create an NFT identity token
7. **Set Streams** - Create streams using NFT identity
8. **Give** - Direct transfer using NFT identity
9. **Collect** - Collect funds to NFT identity

### Receiving & Splits
10. **Automatic Stream Reception** - Streams flow automatically to receivers
11. **Split Processing** - Funds are automatically split according to configuration
12. **Collection** - Recipients collect their funds

## Prerequisites

1. **Start Local Aptos Testnet**
   ```bash
   aptos node run-local-testnet --force-restart --assume-yes
   ```

2. **Wait ~25 seconds for testnet to be ready**

3. **Initialize Account**
   ```bash
   cd apps/contract-movement
   aptos init --network custom --rest-url http://127.0.0.1:8080 --faucet-url http://127.0.0.1:8081 --profile default --assume-yes
   ```

4. **Deploy Contracts**
   ```bash
   aptos move publish --named-addresses xylkstream=default,movemate=default --assume-yes --override-size-check --max-gas 200000 --gas-unit-price 100
   ```

5. **Fund Account**
   ```bash
   aptos account fund-with-faucet --account default --amount 500000000
   ```

6. **Get Private Key**
   ```bash
   cat .aptos/config.yaml | grep private_key
   ```

## Running the Test

```bash
cd apps/docs
PRIVATE_KEY="0x<your-private-key>" npx tsx test-comprehensive.ts
```

## Expected Output

The test will:
- ✅ Fund Bob and Charlie for gas
- ✅ Create a stream from Alice to Bob (0.5 APT at 0.001 APT/sec)
- ✅ Give 0.1 APT from Alice to Charlie
- ✅ Configure Charlie to split 50% of received funds to Bob
- ⏳ Wait 10 seconds for streams to accumulate
- ✅ Bob collects his streamed funds
- ✅ Charlie collects his given funds (50% goes to Bob via splits)
- ✅ Alice withdraws from her stream balance
- ✅ Alice mints an NFT identity token
- ✅ NFT creates a stream to Charlie (0.3 APT)
- ✅ NFT gives 0.05 APT to Bob
- ✅ Alice collects from NFT account

## Important Notes

### First Run vs Subsequent Runs

**First Run (Fresh Testnet)**: All tests should pass ✅

**Subsequent Runs (Same Testnet)**: Tests 1 and 7 will fail with `E_INVALID_STREAMS_RECEIVERS(0x6)` because:
- The account already has stream state from the previous run
- The test passes empty `curr_receivers` but the contract expects the actual current configuration
- This is **correct behavior** - the contract enforces stream state integrity

**Solution**: Restart the testnet before each test run:
```bash
# Stop current testnet (Ctrl+C)
# Start fresh testnet
aptos node run-local-testnet --force-restart --assume-yes
# Then follow all setup steps again
```

### Understanding the Flow

1. **Streams** - Continuous token flow over time
   - Set up with `set_streams`
   - Automatically accumulate for receivers
   - Collected via `collect`

2. **Gives** - One-time direct transfers
   - Sent with `give`
   - Go to receiver's splittable balance
   - Collected via `collect`

3. **Splits** - Automatic fund distribution
   - Configured with `set_splits`
   - Applied when `collect` is called
   - Specified as weights (500000 = 50%)

4. **Drivers** - Identity systems
   - **Address Driver**: Uses wallet addresses (driver_id = 1)
   - **NFT Driver**: Uses NFT tokens (driver_id = 2)
   - Both provide same functionality with different identity models

## Troubleshooting

### "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE"
- Account needs more APT for gas
- The test automatically funds Bob and Charlie
- If this fails, check that Alice has enough balance

### "E_INVALID_STREAMS_RECEIVERS"
- You're running the test on a non-fresh testnet
- Restart the testnet and redeploy contracts
- See "First Run vs Subsequent Runs" above

### "Transaction already in mempool"
- Transactions submitted too quickly
- The test includes delays to prevent this
- If it still happens, increase the delay values

### Negative Collection Amounts
- This is normal - it represents gas fees
- The actual collected amount minus gas costs
- Check balance before/after for net change

## Test File Structure

```typescript
// Configuration
CONTRACT_ADDRESS, NODE_URL, APT_FA_METADATA

// Helper Functions
calcAmtPerSec()      - Calculate streaming rate
calcAccountId()      - Calculate address driver account ID
calcNftTokenId()     - Calculate NFT driver token ID
formatAPT()          - Format octas to APT
getBalance()         - Query account balance

// Test Flow
1. Setup accounts (Alice, Bob, Charlie)
2. Fund accounts for gas
3. Run 11 comprehensive tests
4. Display summary
```

## Key Concepts Demonstrated

- **Streaming**: Continuous token flow over time
- **Giving**: One-time direct transfers
- **Splitting**: Automatic fund distribution
- **Collecting**: Receiving accumulated funds
- **Withdrawing**: Removing funds from streams
- **NFT Identity**: Using NFTs as account identifiers
- **I128 Encoding**: Signed integer support for balance deltas

## Success Criteria

A successful test run shows:
- All account setups complete
- Transactions submitted and confirmed
- Balances change as expected
- Splits distribute funds correctly
- NFT operations work properly
- Clean output with ✅ indicators
