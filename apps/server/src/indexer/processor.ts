import { getDb } from '../database/connection.js';
import { extractWalletAddress, getDriverType, getWalletAddress } from '../utils/account.js';
import type {
  MovementEvent,
  StreamsSetEventData,
  SplitsSetEventData,
  GivenEventData,
  ReceivedEventData,
  SqueezedEventData,
  SplitExecutedEventData,
  CollectedEventData,
} from './types.js';

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
  const sequenceNumber = event.sequence_number || '0';

  switch (eventType) {
    case 'StreamsSet':
      await processStreamsSet(deploymentAddress, data as StreamsSetEventData, now, sequenceNumber);
      break;
    case 'SplitsSet':
      await processSplitsSet(deploymentAddress, data as SplitsSetEventData, now, sequenceNumber);
      break;
    case 'Given':
      await processGiven(deploymentAddress, data as GivenEventData, now, sequenceNumber);
      break;
    case 'Received':
      await processReceived(deploymentAddress, data as ReceivedEventData, now, sequenceNumber);
      break;
    case 'Squeezed':
      await processSqueezed(deploymentAddress, data as SqueezedEventData, now, sequenceNumber);
      break;
    case 'SplitExecuted':
      await processSplitExecuted(deploymentAddress, data as SplitExecutedEventData, now, sequenceNumber);
      break;
    case 'Collected':
      await processCollected(deploymentAddress, data as CollectedEventData, now, sequenceNumber);
      break;
  }
}

function extractEventType(fullType: string): string | null {
  const match = fullType.match(/::(\w+)$/);
  return match ? match[1] : null;
}


async function ensureAccount(deploymentAddress: string, accountId: string, now: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .selectFrom('accounts')
    .select('id')
    .where('deployment_address', '=', deploymentAddress)
    .where('account_id', '=', accountId)
    .executeTakeFirst();

  if (!existing) {
    // Get wallet address - for AddressDriver extract from ID, for NFTDriver query chain
    const walletAddress = await getWalletAddress(deploymentAddress, accountId);
    
    await db
      .insertInto('accounts')
      .values({
        deployment_address: deploymentAddress,
        account_id: accountId,
        wallet_address: walletAddress,
        driver_type: getDriverType(accountId),
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
    .insertInto('events')
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
  sequenceNumber: string
): Promise<void> {
  const db = getDb();
  const accountId = data.account_id;
  await ensureAccount(deploymentAddress, accountId, now);

  // Mark existing streams from this sender as inactive
  await db
    .updateTable('streams')
    .set({ active: 0, updated_at: now })
    .where('deployment_address', '=', deploymentAddress)
    .where('sender_id', '=', accountId)
    .execute();

  // Insert/update new streams
  for (let i = 0; i < data.receiver_account_ids.length; i++) {
    const receiverId = data.receiver_account_ids[i];
    const streamId = data.receiver_stream_ids[i];
    const amtPerSec = data.receiver_amt_per_secs[i];
    const start = parseInt(data.receiver_starts[i], 10);
    const duration = parseInt(data.receiver_durations[i], 10);

    await ensureAccount(deploymentAddress, receiverId, now);

    const existing = await db
      .selectFrom('streams')
      .select('id')
      .where('deployment_address', '=', deploymentAddress)
      .where('sender_id', '=', accountId)
      .where('receiver_id', '=', receiverId)
      .where('stream_id', '=', streamId)
      .executeTakeFirst();

    if (existing) {
      await db.updateTable('streams')
        .set({ amt_per_sec: amtPerSec, start_time: start, duration, active: 1, updated_at: now })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db.insertInto('streams')
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

  await storeEvent(deploymentAddress, 'StreamsSet', accountId, data, now, sequenceNumber);
}


async function processSplitsSet(
  deploymentAddress: string,
  data: SplitsSetEventData,
  now: string,
  sequenceNumber: string
): Promise<void> {
  const db = getDb();
  const accountId = data.account_id;
  await ensureAccount(deploymentAddress, accountId, now);

  // Delete existing splits
  await db.deleteFrom('splits')
    .where('deployment_address', '=', deploymentAddress)
    .where('account_id', '=', accountId)
    .execute();

  // Insert new splits
  for (let i = 0; i < data.receiver_account_ids.length; i++) {
    const receiverId = data.receiver_account_ids[i];
    const weight = parseInt(data.receiver_weights[i], 10);
    await ensureAccount(deploymentAddress, receiverId, now);
    await db.insertInto('splits')
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

  await storeEvent(deploymentAddress, 'SplitsSet', accountId, data, now, sequenceNumber);
}

async function processGiven(d: string, data: GivenEventData, now: string, seq: string): Promise<void> {
  await ensureAccount(d, data.account_id, now);
  await ensureAccount(d, data.receiver_id, now);
  await storeEvent(d, 'Given', data.account_id, data, now, seq);
}

async function processReceived(d: string, data: ReceivedEventData, now: string, seq: string): Promise<void> {
  await ensureAccount(d, data.account_id, now);
  await storeEvent(d, 'Received', data.account_id, data, now, seq);
}

async function processSqueezed(d: string, data: SqueezedEventData, now: string, seq: string): Promise<void> {
  await ensureAccount(d, data.account_id, now);
  await ensureAccount(d, data.sender_id, now);
  await storeEvent(d, 'Squeezed', data.account_id, data, now, seq);
}

async function processSplitExecuted(d: string, data: SplitExecutedEventData, now: string, seq: string): Promise<void> {
  await ensureAccount(d, data.account_id, now);
  await storeEvent(d, 'SplitExecuted', data.account_id, data, now, seq);
}

async function processCollected(d: string, data: CollectedEventData, now: string, seq: string): Promise<void> {
  await ensureAccount(d, data.account_id, now);
  await storeEvent(d, 'Collected', data.account_id, data, now, seq);
}
