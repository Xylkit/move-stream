/**
 * Xylkit Stream Flow Test
 * Tests creating a stream between two accounts
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const CONTRACT_ADDRESS = "0x01c5d264990c9a6791e78c10f4d354751e36164ec71f727ffdadb076fa1cdef0";
const config = new AptosConfig({ 
  network: Network.CUSTOM,
  fullnode: "http://localhost:8080",
  faucet: "http://localhost:8081",
});
const aptos = new Aptos(config);

async function main() {
  console.log("🌊 Testing Xylkit Stream Flow\n");

  // Load sender account
  const privateKeyHex = process.env.PRIVATE_KEY || "";
  if (!privateKeyHex) {
    console.error("❌ PRIVATE_KEY environment variable not set");
    process.exit(1);
  }

  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const sender = Account.fromPrivateKey({ privateKey });
  
  // Create a receiver account
  const receiver = Account.generate();
  
  console.log(`Sender: ${sender.accountAddress.toString()}`);
  console.log(`Receiver: ${receiver.accountAddress.toString()}\n`);

  // Fund receiver account
  console.log("💰 Funding receiver account...");
  try {
    await aptos.fundAccount({
      accountAddress: receiver.accountAddress,
      amount: 100_000_000, // 1 APT
    });
    console.log("✅ Receiver funded\n");
  } catch (error) {
    console.error("❌ Failed to fund receiver:", error);
    process.exit(1);
  }

  // Test: Initialize Drips for sender using address_driver
  console.log("🚀 Test 1: Initialize sender account in Drips...");
  try {
    const txn = await aptos.transaction.build.simple({
      sender: sender.accountAddress,
      data: {
        function: `${CONTRACT_ADDRESS}::address_driver::give`,
        typeArguments: ["0x1::aptos_coin::AptosCoin"],
        functionArguments: [
          receiver.accountAddress.toString(), // receiver
          1000000, // amount (0.01 APT)
        ],
      },
    });

    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: sender,
      transaction: txn,
    });

    await aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    console.log(`✅ Transaction successful: ${committedTxn.hash}\n`);
  } catch (error: any) {
    console.log(`⚠️  Give function test: ${error.message}\n`);
  }

  // Test: Check if we can query account info
  console.log("🔍 Test 2: Query account resources...");
  try {
    const resources = await aptos.getAccountResources({
      accountAddress: sender.accountAddress,
    });
    
    const dripsResources = resources.filter(r => 
      r.type.includes(CONTRACT_ADDRESS)
    );
    
    if (dripsResources.length > 0) {
      console.log(`✅ Found ${dripsResources.length} Drips-related resources:`);
      dripsResources.forEach(r => {
        console.log(`   - ${r.type.split("::").slice(-1)[0]}`);
      });
    } else {
      console.log("⚠️  No Drips resources found yet (account not initialized)");
    }
    console.log();
  } catch (error) {
    console.error("❌ Failed to query resources:", error);
  }

  console.log("✨ Stream flow test completed!");
  console.log("\n📝 Next steps:");
  console.log("   - Implement stream creation");
  console.log("   - Test collecting funds");
  console.log("   - Test splits functionality");
}

main().catch(console.error);
