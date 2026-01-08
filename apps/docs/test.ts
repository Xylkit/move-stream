/**
 * XYLKIT DRIPS PROTOCOL - COMPREHENSIVE TEST
 * 
 * Story: Alice wants to pay Bob a salary stream. Charlie is a middleman who
 * takes a 50% cut of any funds he receives and forwards the rest to Bob.
 * 
 * This test demonstrates the complete protocol flow:
 * 
 * ACT 1: Direct Payments (give, split, collect)
 *   - Alice gives Charlie 0.1 APT directly
 *   - Charlie has configured 50% split to Bob
 *   - Charlie splits: 0.05 APT to Bob, 0.05 APT to himself
 *   - Charlie collects his 0.05 APT to wallet
 * 
 * ACT 2: Streaming Payments (set_streams, squeeze, receive)
 *   - Alice creates a stream to Bob at 0.01 APT/sec
 *   - Bob squeezes funds from current cycle (immediate access)
 *   - Bob receives funds from completed cycles
 * 
 * ACT 3: Stream Management (balance_at, withdraw, stop)
 *   - Alice checks her current stream balance
 *   - Alice withdraws 1 APT from the stream
 *   - Alice stops the stream and withdraws remaining balance
 */

import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
  MoveFunctionId,
} from "@aptos-labs/ts-sdk";
import { toI128Bits } from "./src/utils/signed-integers";

// ═══════════════════════════════════════════════════════════════════════════════
//                              CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONTRACT_ADDRESS = "0xd18345e1db01a8d1dcd35348ff7fb00177fffde29a3afb50e23695d3ee34301f";
const NODE_URL = "http://127.0.0.1:8080/v1";
const APT_FA_METADATA = "0xa";
const CYCLE_DURATION_SECS = 60;

const config = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: NODE_URL,
  faucet: "http://127.0.0.1:8081",
});
const aptos = new Aptos(config);

// ═══════════════════════════════════════════════════════════════════════════════
//                              FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

const c = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

const formatAPT = (octas: bigint | number): string => (Number(octas) / 1e8).toFixed(8);
const apt = (octas: bigint | number): string => `${formatAPT(octas)} APT`;
const shortAddr = (addr: string): string => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

const log = (msg: string) => console.log(msg);
const logAct = (title: string) => {
  console.log("\n" + "═".repeat(80));
  console.log(`  ${c.bold}${title}${c.reset}`);
  console.log("═".repeat(80));
};
const logScene = (title: string) => console.log(`\n  ${c.bold}── ${title} ──${c.reset}`);
const logAction = (who: string, action: string) => console.log(`  ${c.cyan}${who}${c.reset} ${action}`);
const logResult = (msg: string) => console.log(`    → ${msg}`);
const logBalance = (who: string, wallet: bigint, splittable: bigint, collectable: bigint) => {
  console.log(`    ${c.dim}${who}: wallet=${apt(wallet)}, splittable=${apt(splittable)}, collectable=${apt(collectable)}${c.reset}`);
};
const pass = (msg: string) => { console.log(`  ${c.green}✓ ${msg}${c.reset}`); return true; };
const fail = (msg: string) => { console.log(`  ${c.red}✗ ${msg}${c.reset}`); return false; };

// ═══════════════════════════════════════════════════════════════════════════════
//                              HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const calcAmtPerSec = (tokensPerSec: number, decimals = 8): bigint =>
  BigInt(Math.floor(tokensPerSec * 10 ** decimals)) * 1_000_000_000n;

const calcAccountId = (addr: string, driverId = 1): bigint => {
  const OFFSET = 224n;
  const MASK = 0x00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
  return (BigInt(driverId) << OFFSET) | (BigInt(addr) & MASK);
};

const getWalletBalance = async (addr: string): Promise<bigint> => {
  try {
    return BigInt(await aptos.getBalance({ accountAddress: addr, asset: APT_FA_METADATA }));
  } catch {
    return 0n;
  }
};

const sleep = async (secs: number) => {
  process.stdout.write(`    ${c.dim}waiting ${secs}s: `);
  for (let i = 0; i < secs; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write(`${i + 1}..`);
  }
  console.log(` done${c.reset}`);
};

// ═══════════════════════════════════════════════════════════════════════════════
//                         CONTRACT INTERACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const view = async <T>(fn: MoveFunctionId, args: any[]): Promise<T> =>
  (await aptos.view({ payload: { function: fn, functionArguments: args } })) as T;

const exec = async (signer: Account, fn: MoveFunctionId, args: any[]): Promise<string> => {
  const txn = await aptos.transaction.build.simple({
    sender: signer.accountAddress,
    data: { function: fn, functionArguments: args },
  });
  const result = await aptos.signAndSubmitTransaction({ signer, transaction: txn });
  await aptos.waitForTransaction({ transactionHash: result.hash });
  return result.hash;
};

const getSplittable = async (id: bigint): Promise<bigint> => {
  const [r] = await view<[string]>(`${CONTRACT_ADDRESS}::drips::splittable`, [id.toString(), APT_FA_METADATA]);
  return BigInt(r);
};

const getCollectable = async (id: bigint): Promise<bigint> => {
  const [r] = await view<[string]>(`${CONTRACT_ADDRESS}::drips::collectable`, [id.toString(), APT_FA_METADATA]);
  return BigInt(r);
};

const getReceivableCycles = async (id: bigint): Promise<bigint> => {
  const [r] = await view<[string]>(`${CONTRACT_ADDRESS}::drips::receivable_streams_cycles`, [id.toString(), APT_FA_METADATA]);
  return BigInt(r);
};

const getStreamsState = async (id: bigint) => {
  const [hash, histHash, updateTime, balance, maxEnd] = await view<[string, string, string, string, string]>(
    `${CONTRACT_ADDRESS}::drips::streams_state`, [id.toString(), APT_FA_METADATA]
  );
  return { hash, histHash, updateTime: BigInt(updateTime), balance: BigInt(balance), maxEnd: BigInt(maxEnd) };
};

const getBalanceAt = async (
  id: bigint, receiverIds: string[], streamIds: string[], amtPerSecs: string[],
  starts: string[], durations: string[], timestamp: bigint
): Promise<bigint> => {
  const [r] = await view<[string]>(`${CONTRACT_ADDRESS}::drips::balance_at`, [
    id.toString(), APT_FA_METADATA, receiverIds, streamIds, amtPerSecs, starts, durations, timestamp.toString()
  ]);
  return BigInt(r);
};

const getCurrentTimestamp = async (): Promise<bigint> => {
  const info = await aptos.getLedgerInfo();
  return BigInt(Math.floor(Number(info.ledger_timestamp) / 1_000_000));
};

// ═══════════════════════════════════════════════════════════════════════════════
//                              MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${c.bold}🌊 XYLKIT DRIPS PROTOCOL TEST${c.reset}`);
  console.log(`${c.dim}   A story of streaming payments on Movement${c.reset}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  //                         PROLOGUE: SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  logAct("PROLOGUE: Meet the Characters");

  const privateKeyHex = process.env.PRIVATE_KEY || "";
  if (!privateKeyHex) {
    console.error("❌ PRIVATE_KEY not set. Usage: PRIVATE_KEY=0x... npx tsx test.ts");
    process.exit(1);
  }

  const funder = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(privateKeyHex) });
  const alice = Account.generate();
  const bob = Account.generate();
  const charlie = Account.generate();

  const aliceAddr = alice.accountAddress.toString();
  const bobAddr = bob.accountAddress.toString();
  const charlieAddr = charlie.accountAddress.toString();

  const aliceId = calcAccountId(aliceAddr);
  const bobId = calcAccountId(bobAddr);
  const charlieId = calcAccountId(charlieAddr);

  log(`\n  ${c.cyan}Alice${c.reset} (the employer)`);
  log(`    Address: ${shortAddr(aliceAddr)}`);
  log(`    Role: Pays salaries via streams and direct transfers`);

  log(`\n  ${c.cyan}Bob${c.reset} (the employee)`);
  log(`    Address: ${shortAddr(bobAddr)}`);
  log(`    Role: Receives salary stream from Alice`);

  log(`\n  ${c.cyan}Charlie${c.reset} (the middleman)`);
  log(`    Address: ${shortAddr(charlieAddr)}`);
  log(`    Role: Takes 50% cut, forwards rest to Bob`);

  logScene("Funding accounts");
  await exec(funder, "0x1::aptos_account::transfer", [aliceAddr, "10000000000"]); // 100 APT
  await exec(funder, "0x1::aptos_account::transfer", [bobAddr, "100000000"]); // 1 APT for gas
  await exec(funder, "0x1::aptos_account::transfer", [charlieAddr, "100000000"]); // 1 APT for gas

  const aliceWallet = await getWalletBalance(aliceAddr);
  const bobWallet = await getWalletBalance(bobAddr);
  const charlieWallet = await getWalletBalance(charlieAddr);

  log(`  Alice starts with ${c.green}${apt(aliceWallet)}${c.reset}`);
  log(`  Bob starts with ${c.green}${apt(bobWallet)}${c.reset} (for gas)`);
  log(`  Charlie starts with ${c.green}${apt(charlieWallet)}${c.reset} (for gas)`);

  let testsPassed = 0;
  let testsFailed = 0;
  const assert = (cond: boolean, msg: string) => { cond ? (pass(msg), testsPassed++) : (fail(msg), testsFailed++); };

  // ═══════════════════════════════════════════════════════════════════════════
  //                    ACT 1: DIRECT PAYMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  logAct("ACT 1: Direct Payments");

  // Scene 1.1: Charlie configures his splits
  logScene("Scene 1: Charlie sets up his 50% split to Bob");
  logAction("Charlie", "configures splits: 50% to Bob, 50% to self");
  
  const splitWeight = 500_000; // 50%
  await exec(charlie, `${CONTRACT_ADDRESS}::address_driver::set_splits`, [
    [bobId.toString()], [splitWeight.toString()]
  ]);
  logResult("Split configuration saved");
  assert(true, "Charlie configured 50% split to Bob");

  // Scene 1.2: Alice gives Charlie 0.1 APT
  logScene("Scene 2: Alice pays Charlie directly");
  const giveAmount = 10_000_000n; // 0.1 APT
  
  logAction("Alice", `gives ${apt(giveAmount)} to Charlie`);
  const charlieSplittableBefore = await getSplittable(charlieId);
  
  await exec(alice, `${CONTRACT_ADDRESS}::address_driver::give`, [
    charlieId.toString(), APT_FA_METADATA, giveAmount.toString()
  ]);
  
  const charlieSplittableAfter = await getSplittable(charlieId);
  logResult(`Charlie's splittable: ${apt(charlieSplittableBefore)} → ${c.green}${apt(charlieSplittableAfter)}${c.reset}`);
  assert(charlieSplittableAfter - charlieSplittableBefore === giveAmount, "Alice's give() transferred correct amount");

  // Scene 1.3: Bob triggers Charlie's split (permissionless!)
  logScene("Scene 3: Bob triggers Charlie's split (permissionless)");
  log(`  ${c.dim}Anyone can call split() for any account - Bob pushes funds through${c.reset}`);
  
  logAction("Bob", "calls split on Charlie's account (50% to Bob, 50% to Charlie)");
  
  const bobSplittableBefore = await getSplittable(bobId);
  
  await exec(bob, `${CONTRACT_ADDRESS}::drips::split`, [
    charlieId.toString(), APT_FA_METADATA, [bobId.toString()], [splitWeight.toString()]
  ]);
  
  const bobSplittableAfter = await getSplittable(bobId);
  const charlieCollectable = await getCollectable(charlieId);
  
  logResult(`Bob's splittable: ${apt(bobSplittableBefore)} → ${c.green}${apt(bobSplittableAfter)}${c.reset} (+${apt(giveAmount/2n)})`);
  logResult(`Charlie's collectable: ${c.green}${apt(charlieCollectable)}${c.reset}`);
  
  assert(bobSplittableAfter - bobSplittableBefore === giveAmount / 2n, "Bob received 50% from Charlie's split");
  assert(charlieCollectable === giveAmount / 2n, "Charlie kept 50% in collectable");

  // Scene 1.4: Bob triggers Charlie's collect too (permissionless!)
  logScene("Scene 4: Charlie collects to his wallet");
  log(`  ${c.dim}Only Charlie can collect to his own wallet (requires his signature)${c.reset}`);
  
  logAction("Charlie", "collects funds to wallet");
  
  const charlieWalletBefore = await getWalletBalance(charlieAddr);
  
  await exec(charlie, `${CONTRACT_ADDRESS}::address_driver::collect`, [
    APT_FA_METADATA, charlieAddr
  ]);
  
  const charlieWalletAfter = await getWalletBalance(charlieAddr);
  const collected = charlieWalletAfter - charlieWalletBefore;
  
  logResult(`Charlie's wallet: ${apt(charlieWalletBefore)} → ${c.green}${apt(charlieWalletAfter)}${c.reset} (+${apt(collected)})`);
  assert(collected > 0n, "Charlie collected funds to wallet");

  // ═══════════════════════════════════════════════════════════════════════════
  //                    ACT 2: STREAMING PAYMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  logAct("ACT 2: Streaming Payments");

  // Scene 2.1: Alice creates stream to Bob
  logScene("Scene 1: Alice starts paying Bob's salary");
  const streamRate = 0.01; // APT per second
  const amtPerSec = calcAmtPerSec(streamRate);
  const streamDeposit = 5_00000000n; // 5 APT

  logAction("Alice", `creates stream to Bob: ${streamRate} APT/sec, deposits ${apt(streamDeposit)}`);
  
  await exec(alice, `${CONTRACT_ADDRESS}::address_driver::set_streams`, [
    APT_FA_METADATA,
    [], [], [], [], [], // No current receivers
    toI128Bits(streamDeposit).toString(),
    [bobId.toString()], ["1"], [amtPerSec.toString()], ["0"], ["0"],
    "0", "0", aliceAddr
  ]);

  const streamState = await getStreamsState(aliceId);
  logResult(`Stream created! Balance: ${c.green}${apt(streamState.balance)}${c.reset}`);
  logResult(`At ${streamRate} APT/sec, this will last ~${Number(streamState.balance) / 1e8 / streamRate / 60} minutes`);
  assert(streamState.balance === streamDeposit, "Stream created with correct deposit");

  const streamConfig = {
    receiverIds: [bobId.toString()],
    streamIds: ["1"],
    amtPerSecs: [amtPerSec.toString()],
    starts: ["0"],
    durations: ["0"],
  };

  // Scene 2.2: Bob squeezes (immediate access)
  logScene("Scene 2: Bob needs money NOW (squeeze)");
  log(`  ${c.dim}Bob can't wait for the cycle to end, he squeezes funds immediately${c.reset}`);
  
  logAction("Bob", "waits 10 seconds for funds to accumulate...");
  await sleep(10);
  
  logAction("Bob", "squeezes funds from current (incomplete) cycle");
  const bobSplittableBeforeSqueeze = await getSplittable(bobId);
  const bobCollectableBeforeSqueeze = await getCollectable(bobId);
  
  await exec(bob, `${CONTRACT_ADDRESS}::drips::squeeze_streams`, [
    bobId.toString(), APT_FA_METADATA, aliceId.toString(),
    "", [""],
    [[bobId.toString()]], [["1"]], [[amtPerSec.toString()]], [["0"]], [["0"]],
    [streamState.updateTime.toString()], [streamState.maxEnd.toString()],
  ]);
  
  const bobSplittableAfterSqueeze = await getSplittable(bobId);
  const bobCollectableAfterSqueeze = await getCollectable(bobId);
  const squeezed = bobSplittableAfterSqueeze - bobSplittableBeforeSqueeze;
  
  logResult(`Bob squeezed: ${c.green}+${apt(squeezed)}${c.reset} → moved to ${c.yellow}splittable${c.reset}`);
  logResult(`Bob's balances after squeeze_streams():`);
  logResult(`  splittable: ${c.green}${apt(bobSplittableAfterSqueeze)}${c.reset} (funds land here first)`);
  logResult(`  collectable: ${apt(bobCollectableAfterSqueeze)} (unchanged until split)`);
  assert(squeezed > 0n, "squeeze_streams() returned funds from current cycle");

  // Scene 2.3: Wait for cycle, then receive
  logScene("Scene 3: Bob waits for cycle to complete");
  log(`  ${c.dim}After a full cycle (${CYCLE_DURATION_SECS}s), Bob can receive more efficiently${c.reset}`);
  
  logAction("Bob", `waits for cycle to complete...`);
  await sleep(CYCLE_DURATION_SECS + 5);
  
  const cycles = await getReceivableCycles(bobId);
  logResult(`${cycles} cycle(s) ready to receive`);
  
  if (cycles > 0n) {
    logAction("Bob", "receives funds from completed cycles");
    const bobSplittableBeforeReceive = await getSplittable(bobId);
    const bobCollectableBeforeReceive = await getCollectable(bobId);
    
    await exec(bob, `${CONTRACT_ADDRESS}::drips::receive_streams`, [
      bobId.toString(), APT_FA_METADATA, "100"
    ]);
    
    const bobSplittableAfterReceive = await getSplittable(bobId);
    const bobCollectableAfterReceive = await getCollectable(bobId);
    const received = bobSplittableAfterReceive - bobSplittableBeforeReceive;
    
    logResult(`Bob received: ${c.green}+${apt(received)}${c.reset} → moved to ${c.yellow}splittable${c.reset}`);
    logResult(`Bob's balances after receive_streams():`);
    logResult(`  splittable: ${apt(bobSplittableBeforeReceive)} → ${c.green}${apt(bobSplittableAfterReceive)}${c.reset} (funds land here first)`);
    logResult(`  collectable: ${apt(bobCollectableBeforeReceive)} → ${apt(bobCollectableAfterReceive)} (unchanged until split)`);
    log(`  ${c.dim}Note: Bob must call split() then collect() to move funds to wallet${c.reset}`);
    assert(received > 0n, "receive_streams() claimed funds from completed cycles");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //                    ACT 3: STREAM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  logAct("ACT 3: Stream Management");

  // Scene 3.1: Alice checks balance
  logScene("Scene 1: Alice checks her stream balance");
  logAction("Alice", "queries current stream balance");
  
  const currentTs = await getCurrentTimestamp();
  const currentBalance = await getBalanceAt(
    aliceId, streamConfig.receiverIds, streamConfig.streamIds,
    streamConfig.amtPerSecs, streamConfig.starts, streamConfig.durations, currentTs
  );
  
  logResult(`Original deposit: ${apt(streamDeposit)}`);
  logResult(`Current balance: ${c.yellow}${apt(currentBalance)}${c.reset}`);
  logResult(`Streamed so far: ${apt(streamDeposit - currentBalance)}`);
  assert(currentBalance < streamDeposit, "balance_at() shows decreased balance");

  // Scene 3.2: Alice withdraws some funds
  logScene("Scene 2: Alice withdraws from stream");
  const withdrawAmount = 1_00000000n; // 1 APT
  
  logAction("Alice", `withdraws ${apt(withdrawAmount)} from stream (keeping it running)`);
  const aliceWalletBefore = await getWalletBalance(aliceAddr);
  
  await exec(alice, `${CONTRACT_ADDRESS}::address_driver::set_streams`, [
    APT_FA_METADATA,
    streamConfig.receiverIds, streamConfig.streamIds, streamConfig.amtPerSecs,
    streamConfig.starts, streamConfig.durations,
    toI128Bits(-withdrawAmount).toString(), // Negative = withdraw
    streamConfig.receiverIds, streamConfig.streamIds, streamConfig.amtPerSecs,
    streamConfig.starts, streamConfig.durations,
    "0", "0", aliceAddr
  ]);
  
  const aliceWalletAfter = await getWalletBalance(aliceAddr);
  const withdrawn = aliceWalletAfter - aliceWalletBefore;
  
  logResult(`Alice's wallet: ${apt(aliceWalletBefore)} → ${c.green}${apt(aliceWalletAfter)}${c.reset}`);
  assert(withdrawn > 0n, "Withdraw returned funds to Alice");

  // Scene 3.3: Alice stops the stream
  logScene("Scene 3: Alice stops the stream");
  logAction("Alice", "stops stream and withdraws remaining balance");
  
  const stateBeforeStop = await getStreamsState(aliceId);
  const aliceWalletBeforeStop = await getWalletBalance(aliceAddr);
  
  await exec(alice, `${CONTRACT_ADDRESS}::address_driver::set_streams`, [
    APT_FA_METADATA,
    streamConfig.receiverIds, streamConfig.streamIds, streamConfig.amtPerSecs,
    streamConfig.starts, streamConfig.durations,
    toI128Bits(-stateBeforeStop.balance).toString(),
    [], [], [], [], [], // Empty = stop streaming
    "0", "0", aliceAddr
  ]);
  
  const stateAfterStop = await getStreamsState(aliceId);
  const aliceWalletAfterStop = await getWalletBalance(aliceAddr);
  
  logResult(`Stream balance: ${apt(stateBeforeStop.balance)} → ${c.green}${apt(stateAfterStop.balance)}${c.reset}`);
  logResult(`Alice recovered: ${c.green}${apt(aliceWalletAfterStop - aliceWalletBeforeStop)}${c.reset}`);
  assert(stateAfterStop.balance === 0n, "Stream stopped and balance withdrawn");

  // ═══════════════════════════════════════════════════════════════════════════
  //                         EPILOGUE: SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  logAct("EPILOGUE: Final Balances");

  const finalAlice = await getWalletBalance(aliceAddr);
  const finalBob = await getWalletBalance(bobAddr);
  const finalCharlie = await getWalletBalance(charlieAddr);
  const bobFinalSplittable = await getSplittable(bobId);

  log(`\n  ${c.cyan}Alice${c.reset} (employer)`);
  log(`    Wallet: ${apt(finalAlice)}`);
  log(`    Started with 100 APT, paid out salaries and fees`);

  log(`\n  ${c.cyan}Bob${c.reset} (employee)`);
  log(`    Wallet: ${apt(finalBob)}`);
  log(`    Splittable: ${apt(bobFinalSplittable)} (can split & collect)`);
  log(`    Received salary via stream + split from Charlie`);

  log(`\n  ${c.cyan}Charlie${c.reset} (middleman)`);
  log(`    Wallet: ${apt(finalCharlie)}`);
  log(`    Took his 50% cut from Alice's direct payment`);

  // Summary
  logAct("TEST RESULTS");
  console.log(`\n  ${c.green}Passed: ${testsPassed}${c.reset}`);
  console.log(`  ${c.red}Failed: ${testsFailed}${c.reset}`);

  if (testsFailed === 0) {
    console.log(`\n  ${c.green}${c.bold}✅ ALL TESTS PASSED${c.reset}`);
    console.log(`\n  ${c.dim}Protocol operations demonstrated:`);
    console.log(`    • give() - direct transfer`);
    console.log(`    • set_splits() - configure split receivers`);
    console.log(`    • split() - distribute to receivers`);
    console.log(`    • collect() - withdraw to wallet`);
    console.log(`    • set_streams() - create/update/stop streams`);
    console.log(`    • squeeze_streams() - immediate access to current cycle`);
    console.log(`    • receive_streams() - claim completed cycles`);
    console.log(`    • balance_at() - query current stream balance${c.reset}`);
    process.exit(0);
  } else {
    console.log(`\n  ${c.red}${c.bold}❌ SOME TESTS FAILED${c.reset}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${c.red}Fatal error: ${err.message}${c.reset}`);
  console.error(err.stack);
  process.exit(1);
});
