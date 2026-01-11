import express from "express";
import { getDb } from "../database/connection.js";
import { runSync } from "../indexer/sync.js";
import { calcAccountId } from "../utils/account.js";

const router = express.Router();

/**
 * Get RPC URL from environment
 */
const getRpcUrl = () =>
  process.env.MOVEMENT_RPC_URL || "https://aptos.testnet.porto.movementlabs.xyz/v1";

/**
 * Find the deployment's first transaction version
 * This is when the contract was deployed - we start scanning from here
 */
async function findDeploymentStartVersion(address: string): Promise<string> {
  try {
    // Get account info to see total transactions
    const accountUrl = `${getRpcUrl()}/accounts/${address}`;
    const accountRes = await fetch(accountUrl);

    if (!accountRes.ok) {
      console.log(`[Search] Could not fetch account info, starting at 0`);
      return "0";
    }

    const account = (await accountRes.json()) as { sequence_number?: string };
    const totalTxs = parseInt(account.sequence_number || "0");

    if (totalTxs === 0) {
      console.log(`[Search] Account has no transactions, starting at 0`);
      return "0";
    }

    // Fetch all transactions to find the oldest
    const txUrl = `${getRpcUrl()}/accounts/${address}/transactions?start=0&limit=${Math.min(
      totalTxs,
      1000
    )}`;
    const txRes = await fetch(txUrl);

    if (!txRes.ok) {
      console.log(`[Search] Could not fetch transactions, starting at 0`);
      return "0";
    }

    const txs = (await txRes.json()) as Array<{ version: string }>;
    if (txs.length === 0) {
      console.log(`[Search] No transactions found, starting at 0`);
      return "0";
    }

    // Find oldest transaction
    let oldestVersion = parseInt(txs[0].version);
    for (const tx of txs) {
      const version = parseInt(tx.version);
      if (version < oldestVersion) oldestVersion = version;
    }

    // Start a bit before the first transaction
    const start = Math.max(0, oldestVersion - 10).toString();
    console.log(
      `[Search] Deployment first tx at ${oldestVersion}, starting cursor at ${start}`
    );
    return start;
  } catch (err) {
    console.error("[Search] Failed to find deployment start version:", err);
    return "0";
  }
}

/**
 * Check if address has ::drips module (is a Xylkit deployment)
 */
async function hasXylkitModule(address: string): Promise<boolean> {
  try {
    const url = `${getRpcUrl()}/accounts/${address}/module/drips`;
    console.log(`[Search] Checking module at: ${url}`);
    const response = await fetch(url);
    console.log(`[Search] Module check response: ${response.status}`);
    return response.ok; // 200 = module exists, 404 = not a deployment
  } catch (err) {
    console.error("[Search] Module check failed:", err);
    return false;
  }
}

/**
 * GET /search?q=0x...
 * Determines if address is a deployment (has ::drips module) or user
 * Auto-registers new deployments and users in DB, triggers background sync
 */
router.get("/", async (req, res, next) => {
  try {
    const q = (req.query.q as string)?.trim();
    console.log(`[Search] Query: ${q}`);
    if (!q || !q.startsWith("0x")) {
      return res.status(400).json({ error: "Invalid address format" });
    }

    // Validate address is complete (66 chars for 0x + 64 hex digits)
    if (q.length !== 66) {
      return res
        .status(400)
        .json({ error: "Address must be 66 characters (0x + 64 hex digits)" });
    }

    const db = getDb();

    // First check our DB (faster)
    const knownDeployment = await db
      .selectFrom("deployments")
      .select("address")
      .where("address", "=", q)
      .executeTakeFirst();

    console.log(`[Search] Known deployment:`, knownDeployment);

    if (knownDeployment) {
      // Trigger background sync for this deployment (fire and forget)
      runSync({ deployment: q }).catch(() => {});
      return res.json({ type: "deployment", address: q });
    }

    // Check on-chain if it has drips module
    const isDeployment = await hasXylkitModule(q);
    console.log(`[Search] hasXylkitModule(${q}):`, isDeployment);

    if (isDeployment) {
      // Find deployment start version (when contract was deployed)
      const startVersion = await findDeploymentStartVersion(q);
      console.log(`[Search] New deployment ${q}, starting cursor at ${startVersion}`);

      // Register this new deployment (no end version - scan to chain tip)
      await db
        .insertInto("deployments")
        .values({
          address: q,
          network: "movement-testnet",
          first_seen_at: new Date().toISOString(),
          last_tx_version: null,
        })
        .onConflict((oc) => oc.column("address").doNothing())
        .execute();

      // Initialize cursor at start version
      await db
        .insertInto("sync_cursors")
        .values({
          deployment_address: q,
          event_type: "transactions",
          last_sequence: startVersion,
          updated_at: new Date().toISOString(),
        })
        .onConflict((oc) => oc.columns(["deployment_address", "event_type"]).doNothing())
        .execute();

      // Trigger background sync
      runSync({ deployment: q }).catch(() => {});

      return res.json({ type: "deployment", address: q });
    }

    // It's a user address - find deployments they've interacted with
    const accountId = calcAccountId(q).toString();

    // Check if we have a discovery cursor for this user
    const discoveryCursor = await db
      .selectFrom("sync_cursors")
      .select("last_sequence")
      .where("deployment_address", "=", q) // Using address as key for user discovery
      .where("event_type", "=", "user_discovery")
      .executeTakeFirst();

    const startSequence = discoveryCursor ? parseInt(discoveryCursor.last_sequence) : 0;
    const batchSize = 100; // Process 100 transactions per request (stays under Vercel timeout)

    // Query user's transactions to find Drips interactions
    const discoveredDeployments = new Set<string>();
    let lastSequence = startSequence;
    let hasMore = false;

    try {
      const txUrl = `${getRpcUrl()}/accounts/${q}/transactions?start=${startSequence}&limit=${batchSize}`;
      const txRes = await fetch(txUrl);
      if (txRes.ok) {
        const txs = (await txRes.json()) as Array<{
          sequence_number: string;
          events?: Array<{ type: string }>;
        }>;

        if (txs.length === batchSize) {
          hasMore = true; // More transactions to process
        }

        // Look for events from Drips contracts
        for (const tx of txs) {
          lastSequence = parseInt(tx.sequence_number);
          if (!tx.events) continue;

          for (const event of tx.events) {
            // Check if event is from a drips module
            if (event.type.includes("::drips::")) {
              const deploymentAddr = event.type.split("::")[0];

              // Verify it has the drips module
              const hasModule = await hasXylkitModule(deploymentAddr);
              if (hasModule) {
                discoveredDeployments.add(deploymentAddr);
              }
            }
          }
        }

        // Update discovery cursor
        await db
          .insertInto("sync_cursors")
          .values({
            deployment_address: q,
            event_type: "user_discovery",
            last_sequence: lastSequence.toString(),
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc) =>
            oc.columns(["deployment_address", "event_type"]).doUpdateSet({
              last_sequence: lastSequence.toString(),
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      }
    } catch (err) {
      console.error("[Search] Failed to discover deployments from user transactions:", err);
    }

    console.log(
      `[Search] User ${q} batch: ${startSequence}-${lastSequence}, found ${discoveredDeployments.size} deployment(s), hasMore: ${hasMore}`
    );

    // Register discovered deployments
    for (const depAddr of discoveredDeployments) {
      // Use binary search to find deployment version
      const deploymentVersion = await findDeploymentStartVersion(depAddr);

      await db
        .insertInto("deployments")
        .values({
          address: depAddr,
          network: "movement-testnet",
          first_seen_at: new Date().toISOString(),
        })
        .onConflict((oc) => oc.column("address").doNothing())
        .execute();

      // Initialize cursor
      await db
        .insertInto("sync_cursors")
        .values({
          deployment_address: depAddr,
          event_type: "transactions",
          last_sequence: deploymentVersion,
          updated_at: new Date().toISOString(),
        })
        .onConflict((oc) => oc.columns(["deployment_address", "event_type"]).doNothing())
        .execute();

      // Trigger background sync
      runSync({ deployment: depAddr, limit: 5000 }).catch(() => {});
    }

    // Get all known deployments to register user across them
    const deployments = await db.selectFrom("deployments").select("address").execute();

    // Only register and sync if deployments exist
    if (deployments.length > 0) {
      for (const dep of deployments) {
        await db
          .insertInto("accounts")
          .values({
            deployment_address: dep.address,
            account_id: accountId,
            wallet_address: q,
            driver_type: 1, // AddressDriver
            driver_name: "address_driver", // Assume AddressDriver for wallet address search
            created_at: new Date().toISOString(),
          })
          .onConflict((oc) => oc.columns(["deployment_address", "account_id"]).doNothing())
          .execute();
      }

      // Trigger background sync with user priority
      runSync({ user: q }).catch(() => {});
    }

    return res.json({
      type: "user",
      address: q,
      deploymentsDiscovered: discoveredDeployments.size,
      discoveryProgress: {
        processed: lastSequence,
        hasMore,
        batchSize,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
