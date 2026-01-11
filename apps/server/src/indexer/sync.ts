import { getDb } from "../database/connection.js";
import { processEvent } from "./processor.js";
import type { MovementEvent } from "./types.js";

const getRpcUrl = () =>
  process.env.MOVEMENT_RPC_URL || "https://aptos.testnet.porto.movementlabs.xyz/v1";
const EVENT_TYPES = [
  "StreamsSet",
  "SplitsSet",
  "Given",
  "Received",
  "Squeezed",
  "SplitExecuted",
  "Collected",
];
const SYNC_COOLDOWN_MS = 30_000; // 30 seconds

interface SyncOptions {
  deployment?: string;
  accountId?: string;
  force?: boolean;
  limit?: number;
}

interface SyncResult {
  deployment: string;
  eventsProcessed: number;
  skipped: boolean;
  reason?: string;
  lastSyncedAt: string;
  nextSyncAvailableAt: string;
  hasMore?: boolean;
  cursor?: string;
}

async function canSync(
  deployment: string
): Promise<{ allowed: boolean; lastSyncedAt: string | null; nextAvailable: string }> {
  const db = getDb();
  const meta = await db
    .selectFrom("sync_metadata")
    .select(["last_synced_at", "events_processed", "has_more"])
    .where("deployment_address", "=", deployment)
    .executeTakeFirst();

  if (!meta) {
    return { allowed: true, lastSyncedAt: null, nextAvailable: new Date().toISOString() };
  }

  // If there's more data to sync, skip cooldown
  if (meta.has_more) {
    return {
      allowed: true,
      lastSyncedAt: meta.last_synced_at,
      nextAvailable: new Date().toISOString(),
    };
  }

  const lastSync = new Date(meta.last_synced_at).getTime();
  const now = Date.now();
  const nextAvailable = new Date(lastSync + SYNC_COOLDOWN_MS).toISOString();

  // Apply cooldown only when sync is complete (has_more = false)
  if (now - lastSync < SYNC_COOLDOWN_MS) {
    return { allowed: false, lastSyncedAt: meta.last_synced_at, nextAvailable };
  }

  return {
    allowed: true,
    lastSyncedAt: meta.last_synced_at,
    nextAvailable: new Date().toISOString(),
  };
}

/**
 * Fetch events from global transactions
 * Scans all transactions for events from this deployment
 */
async function fetchEventsFromTransactions(
  deployment: string,
  startVersion: string,
  limit: number
): Promise<{ events: MovementEvent[]; lastVersion: string; transactionsFetched: number }> {
  const events: MovementEvent[] = [];
  let lastVersion = startVersion;
  let transactionsFetched = 0;

  try {
    // Scan global transactions
    const url = `${getRpcUrl()}/transactions?start=${startVersion}&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      return { events: [], lastVersion, transactionsFetched: 0 };
    }

    const transactions = (await response.json()) as Array<{
      version: string;
      hash: string;
      timestamp: string;
      type: string;
      sender?: string; // Transaction sender address
      payload?: {
        function?: string; // Entry function like "0x123::address_driver::set_streams"
      };
      events?: Array<{
        type: string;
        data: Record<string, unknown>;
        sequence_number: string;
        guid: { creation_number: string; account_address: string };
      }>;
    }>;

    transactionsFetched = transactions.length;

    for (const tx of transactions) {
      lastVersion = tx.version;

      if (!tx.events) continue;

      for (const event of tx.events) {
        if (!event.type.startsWith(deployment)) continue;

        const typeParts = event.type.split("::");
        if (typeParts.length >= 3) {
          const eventName = typeParts[typeParts.length - 1];

          if (EVENT_TYPES.includes(eventName)) {
            events.push({
              type: event.type,
              data: event.data,
              sequence_number: event.sequence_number,
              version: tx.version,
              tx_hash: tx.hash,
              timestamp: tx.timestamp,
              sender: tx.sender, // Include transaction sender
              entry_function: tx.payload?.function, // Include entry function for driver detection
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[Sync] Failed to fetch transactions:", err);
  }

  return { events, lastVersion, transactionsFetched };
}

export async function syncDeployment(options: SyncOptions): Promise<SyncResult> {
  const db = getDb();
  const deployment = options.deployment;

  if (!deployment) {
    throw new Error("No deployment specified");
  }

  if (!options.force) {
    const { allowed, lastSyncedAt, nextAvailable } = await canSync(deployment);
    if (!allowed) {
      return {
        deployment,
        eventsProcessed: 0,
        skipped: true,
        reason: "cooldown",
        lastSyncedAt: lastSyncedAt!,
        nextSyncAvailableAt: nextAvailable,
      };
    }
  }

  const startTime = Date.now();
  await ensureDeployment(deployment);

  // Get current ledger version (chain tip)
  let chainTip = 999999999;
  try {
    const res = await fetch(getRpcUrl());
    if (res.ok) {
      const info = (await res.json()) as { ledger_version: string };
      chainTip = parseInt(info.ledger_version);
    }
  } catch {
    /* use default */
  }

  // Get last synced version
  const cursor = await db
    .selectFrom("sync_cursors")
    .select("last_sequence")
    .where("deployment_address", "=", deployment)
    .where("event_type", "=", "transactions")
    .executeTakeFirst();

  const startVersion = cursor?.last_sequence || "0";

  // Check if we've caught up to chain tip
  if (parseInt(startVersion) >= chainTip) {
    const now = new Date().toISOString();
    await db
      .insertInto("sync_metadata")
      .values({
        deployment_address: deployment,
        last_synced_at: now,
        events_processed: 0,
        sync_duration_ms: 0,
        has_more: 0,
      })
      .onConflict((oc) =>
        oc.column("deployment_address").doUpdateSet({
          last_synced_at: now,
          events_processed: 0,
          sync_duration_ms: 0,
          has_more: 0,
        })
      )
      .execute();

    return {
      deployment,
      eventsProcessed: 0,
      skipped: false,
      lastSyncedAt: now,
      nextSyncAvailableAt: new Date(Date.now() + SYNC_COOLDOWN_MS).toISOString(),
      hasMore: false,
      cursor: startVersion,
    };
  }

  const limit = Math.min(options.limit || 100, 100); // API max is 100

  const { events, lastVersion, transactionsFetched } = await fetchEventsFromTransactions(
    deployment,
    startVersion,
    limit
  );

  let totalProcessed = 0;
  for (const event of events) {
    if (options.accountId) {
      const data = event.data as Record<string, unknown>;
      const ids = [data.account_id, data.sender_id, data.receiver_id]
        .filter(Boolean)
        .map(String);
      if (!ids.includes(options.accountId)) continue;
    }
    await processEvent(deployment, event);
    totalProcessed++;
  }

  // Update cursor with last version
  if (lastVersion !== startVersion) {
    await db
      .insertInto("sync_cursors")
      .values({
        deployment_address: deployment,
        event_type: "transactions",
        last_sequence: lastVersion,
        updated_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc
          .columns(["deployment_address", "event_type"])
          .doUpdateSet({ last_sequence: lastVersion, updated_at: new Date().toISOString() })
      )
      .execute();
  }

  const syncDuration = Date.now() - startTime;
  const now = new Date().toISOString();

  // hasMore = we fetched a full batch AND haven't reached chain tip
  const hasMore = transactionsFetched === limit && parseInt(lastVersion) < chainTip;

  await db
    .insertInto("sync_metadata")
    .values({
      deployment_address: deployment,
      last_synced_at: now,
      events_processed: totalProcessed,
      sync_duration_ms: syncDuration,
      has_more: hasMore ? 1 : 0,
    })
    .onConflict((oc) =>
      oc.column("deployment_address").doUpdateSet({
        last_synced_at: now,
        events_processed: totalProcessed,
        sync_duration_ms: syncDuration,
        has_more: hasMore ? 1 : 0,
      })
    )
    .execute();

  return {
    deployment,
    eventsProcessed: totalProcessed,
    skipped: false,
    lastSyncedAt: now,
    nextSyncAvailableAt: new Date(Date.now() + SYNC_COOLDOWN_MS).toISOString(),
    hasMore,
    cursor: lastVersion,
  };
}

async function ensureDeployment(address: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .selectFrom("deployments")
    .select("address")
    .where("address", "=", address)
    .executeTakeFirst();
  if (!existing) {
    await db
      .insertInto("deployments")
      .values({
        address,
        network: "movement-testnet",
        first_seen_at: new Date().toISOString(),
      })
      .execute();
  }
}

export async function syncAll(force = false): Promise<SyncResult[]> {
  const db = getDb();
  const deployments = await db.selectFrom("deployments").select("address").execute();
  return Promise.all(
    deployments.map((dep) => syncDeployment({ deployment: dep.address, force }))
  );
}

export async function runSync(
  options: { deployment?: string; user?: string; force?: boolean; limit?: number } = {}
): Promise<SyncResult> {
  const db = getDb();

  let accountId: string | undefined;
  if (options.user) {
    const { calcAccountId } = await import("../utils/account.js");
    accountId = calcAccountId(options.user).toString();
  }

  let deployment = options.deployment;
  if (!deployment) {
    // If no deployment specified, use the first one in DB
    const first = await db.selectFrom("deployments").select("address").executeTakeFirst();
    deployment = first?.address;
  }

  if (!deployment) {
    throw new Error("No deployment to sync");
  }

  return syncDeployment({
    deployment,
    accountId,
    force: options.force,
    limit: options.limit,
  });
}

export async function getSyncStatus(
  deployment?: string
): Promise<{ deployment: string; lastSyncedAt: string | null; ageMs: number }[]> {
  const db = getDb();

  let query = db
    .selectFrom("sync_metadata")
    .select([
      "deployment_address",
      "last_synced_at",
      "events_processed",
      "sync_duration_ms",
    ]);
  if (deployment) {
    query = query.where("deployment_address", "=", deployment);
  }

  const rows = await query.execute();
  const now = Date.now();

  return rows.map((r) => ({
    deployment: r.deployment_address,
    lastSyncedAt: r.last_synced_at,
    ageMs: now - new Date(r.last_synced_at).getTime(),
  }));
}
