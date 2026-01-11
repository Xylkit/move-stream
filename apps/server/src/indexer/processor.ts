import { getDb } from "../database/connection.js";
import { extractWalletAddress, getDriverType, getWalletAddress } from "../utils/account.js";
import { ensureToken } from "../utils/token.js";
import type {
  MovementEvent,
  StreamsSetEventData,
  SplitsSetEventData,
  GivenEventData,
  ReceivedEventData,
  SqueezedEventData,
  SplitExecutedEventData,
  CollectedEventData,
} from "./types.js";

/**
 * Process a single event and update the database
 */
export async function processEvent(
  deploymentAddress: string,
  event: MovementEvent
): Promise<void> {
  const eventType = extractEventType(event.type);
  if (!eventType) return;

  const now = new Date().toISOString();
  const data = event.data as unknown;
  const sequenceNumber = event.sequence_number || "0";
  const senderAddress = event.sender; // Transaction sender address
  const entryFunction = event.entry_function; // Entry function for driver detection

  // Ensure token metadata is cached for this event
  const eventData = data as Record<string, unknown>;
  if (eventData.fa_metadata) {
    await ensureToken(eventData.fa_metadata as string);
  }

  switch (eventType) {
    case "StreamsSet":
      await processStreamsSet(
        deploymentAddress,
        data as StreamsSetEventData,
        now,
        sequenceNumber,
        senderAddress,
        entryFunction
      );
      break;
    case "SplitsSet":
      await processSplitsSet(
        deploymentAddress,
        data as SplitsSetEventData,
        now,
        sequenceNumber,
        senderAddress,
        entryFunction
      );
      break;
    case "Given":
      await processGiven(
        deploymentAddress,
        data as GivenEventData,
        now,
        sequenceNumber,
        senderAddress,
        entryFunction
      );
      break;
    case "Received":
      await processReceived(
        deploymentAddress,
        data as ReceivedEventData,
        now,
        sequenceNumber,
        senderAddress,
        entryFunction
      );
      break;
    case "Squeezed":
      await processSqueezed(
        deploymentAddress,
        data as SqueezedEventData,
        now,
        sequenceNumber,
        senderAddress,
        entryFunction
      );
      break;
    case "SplitExecuted":
      await processSplitExecuted(
        deploymentAddress,
        data as SplitExecutedEventData,
        now,
        sequenceNumber,
        senderAddress,
        entryFunction
      );
      break;
    case "Collected":
      await processCollected(
        deploymentAddress,
        data as CollectedEventData,
        now,
        sequenceNumber,
        senderAddress,
        entryFunction
      );
      break;
  }
}

function extractEventType(fullType: string): string | null {
  const match = fullType.match(/::(\w+)$/);
  return match ? match[1] : null;
}

/**
 * Extract driver name from entry function
 * Example: "0x123::address_driver::set_streams" → "address_driver"
 */
function extractDriverName(entryFunction?: string): string | null {
  if (!entryFunction) return null;
  const parts = entryFunction.split("::");
  if (parts.length >= 2) {
    return parts[1]; // Module name (e.g., "address_driver", "nft_driver")
  }
  return null;
}

async function ensureAccount(
  deploymentAddress: string,
  accountId: string,
  now: string,
  txSenderAddress?: string,
  entryFunction?: string
): Promise<void> {
  const db = getDb();
  const existing = await db
    .selectFrom("accounts")
    .select("id")
    .where("deployment_address", "=", deploymentAddress)
    .where("account_id", "=", accountId)
    .executeTakeFirst();

  if (!existing) {
    // Determine wallet address:
    // 1. If transaction sender matches this account ID, use sender address (most accurate)
    // 2. Otherwise, try to extract from account ID or query chain
    let walletAddress: string | null = null;

    if (txSenderAddress) {
      const driverType = getDriverType(accountId);
      // For AddressDriver, check if sender's account ID matches
      if (driverType === 1) {
        const senderAccountId = await import("../utils/account.js").then((m) =>
          m.calcAccountId(txSenderAddress)
        );
        if (senderAccountId.toString() === accountId) {
          walletAddress = txSenderAddress; // Use full sender address
        }
      }
    }

    // Fallback to extraction/query if sender doesn't match
    if (!walletAddress) {
      walletAddress = await getWalletAddress(deploymentAddress, accountId);
    }

    // Extract driver name from entry function (e.g., "address_driver", "nft_driver")
    const driverName = extractDriverName(entryFunction);

    await db
      .insertInto("accounts")
      .values({
        deployment_address: deploymentAddress,
        account_id: accountId,
        wallet_address: walletAddress,
        driver_type: getDriverType(accountId),
        driver_name: driverName, // Store driver name for accurate identification
        created_at: now,
      })
      .execute();
  }
}

async function storeEvent(
  deploymentAddress: string,
  eventType: string,
  accountId: string,
  data: unknown,
  now: string,
  sequenceNumber: string
): Promise<void> {
  const db = getDb();
  await db
    .insertInto("events")
    .values({
      deployment_address: deploymentAddress,
      event_type: eventType,
      account_id: accountId,
      data: JSON.stringify(data),
      sequence_number: sequenceNumber,
      timestamp: now,
    })
    .execute();
}

async function processStreamsSet(
  deploymentAddress: string,
  data: StreamsSetEventData,
  now: string,
  sequenceNumber: string,
  senderAddress?: string,
  entryFunction?: string
): Promise<void> {
  const db = getDb();
  const accountId = data.account_id;
  await ensureAccount(deploymentAddress, accountId, now, senderAddress, entryFunction);

  // Mark existing streams from this sender as inactive
  await db
    .updateTable("streams")
    .set({ active: 0, updated_at: now })
    .where("deployment_address", "=", deploymentAddress)
    .where("sender_id", "=", accountId)
    .execute();

  // Insert/update new streams
  for (let i = 0; i < data.receiver_account_ids.length; i++) {
    const receiverId = data.receiver_account_ids[i];
    const streamId = data.receiver_stream_ids[i];
    const amtPerSec = data.receiver_amt_per_secs[i];
    const start = parseInt(data.receiver_starts[i], 10);
    const duration = parseInt(data.receiver_durations[i], 10);

    await ensureAccount(deploymentAddress, receiverId, now, senderAddress, entryFunction);

    const existing = await db
      .selectFrom("streams")
      .select("id")
      .where("deployment_address", "=", deploymentAddress)
      .where("sender_id", "=", accountId)
      .where("receiver_id", "=", receiverId)
      .where("stream_id", "=", streamId)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("streams")
        .set({
          amt_per_sec: amtPerSec,
          start_time: start,
          duration,
          active: 1,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .execute();
    } else {
      await db
        .insertInto("streams")
        .values({
          deployment_address: deploymentAddress,
          sender_id: accountId,
          receiver_id: receiverId,
          stream_id: streamId,
          fa_metadata: data.fa_metadata,
          amt_per_sec: amtPerSec,
          start_time: start,
          duration,
          active: 1,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }
  }

  await storeEvent(deploymentAddress, "StreamsSet", accountId, data, now, sequenceNumber);
}

async function processSplitsSet(
  deploymentAddress: string,
  data: SplitsSetEventData,
  now: string,
  sequenceNumber: string,
  senderAddress?: string,
  entryFunction?: string
): Promise<void> {
  const db = getDb();
  const accountId = data.account_id;
  await ensureAccount(deploymentAddress, accountId, now, senderAddress, entryFunction);

  // Delete existing splits
  await db
    .deleteFrom("splits")
    .where("deployment_address", "=", deploymentAddress)
    .where("account_id", "=", accountId)
    .execute();

  // Insert new splits
  for (let i = 0; i < data.receiver_account_ids.length; i++) {
    const receiverId = data.receiver_account_ids[i];
    const weight = parseInt(data.receiver_weights[i], 10);
    await ensureAccount(deploymentAddress, receiverId, now, senderAddress, entryFunction);
    await db
      .insertInto("splits")
      .values({
        deployment_address: deploymentAddress,
        account_id: accountId,
        receiver_id: receiverId,
        weight,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  await storeEvent(deploymentAddress, "SplitsSet", accountId, data, now, sequenceNumber);
}

async function processGiven(
  d: string,
  data: GivenEventData,
  now: string,
  seq: string,
  sender?: string,
  entryFunction?: string
): Promise<void> {
  await ensureAccount(d, data.account_id, now, sender, entryFunction);
  await ensureAccount(d, data.receiver_id, now, sender, entryFunction);
  await storeEvent(d, "Given", data.account_id, data, now, seq);
}

async function processReceived(
  d: string,
  data: ReceivedEventData,
  now: string,
  seq: string,
  sender?: string,
  entryFunction?: string
): Promise<void> {
  await ensureAccount(d, data.account_id, now, sender, entryFunction);
  await storeEvent(d, "Received", data.account_id, data, now, seq);
}

async function processSqueezed(
  d: string,
  data: SqueezedEventData,
  now: string,
  seq: string,
  sender?: string,
  entryFunction?: string
): Promise<void> {
  await ensureAccount(d, data.account_id, now, sender, entryFunction);
  await ensureAccount(d, data.sender_id, now, sender, entryFunction);
  await storeEvent(d, "Squeezed", data.account_id, data, now, seq);
}

async function processSplitExecuted(
  d: string,
  data: SplitExecutedEventData,
  now: string,
  seq: string,
  sender?: string,
  entryFunction?: string
): Promise<void> {
  await ensureAccount(d, data.account_id, now, sender, entryFunction);
  await storeEvent(d, "SplitExecuted", data.account_id, data, now, seq);
}

async function processCollected(
  d: string,
  data: CollectedEventData,
  now: string,
  seq: string,
  sender?: string,
  entryFunction?: string
): Promise<void> {
  await ensureAccount(d, data.account_id, now, sender, entryFunction);
  await storeEvent(d, "Collected", data.account_id, data, now, seq);
}
