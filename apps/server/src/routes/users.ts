import express from 'express';
import { getDb } from '../database/connection.js';
import { calcAccountId } from '../utils/account.js';
import { getTokenDecimals, formatRate } from '../utils/token.js';

// Format duration in seconds to human readable
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

const router = express.Router();

// GET /users/:address - User across all deployments
// Returns data formatted for UI: per-deployment balances, incoming streams, splits
router.get('/:address', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;
    
    // Calculate account ID for AddressDriver
    const accountId = calcAccountId(address).toString();

    // Find all accounts matching this wallet address or account ID
    const accounts = await db
      .selectFrom('accounts')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('wallet_address', '=', address),
          eb('account_id', '=', accountId),
        ])
      )
      .execute();

    if (accounts.length === 0) {
      return res.json({
        address,
        accountId,
        deployments: [],
      });
    }

    // Get detailed info for each deployment
    const deployments = await Promise.all(accounts.map(async (account) => {
      const db = getDb();
      
      // Get deployment info
      const deployment = await db
        .selectFrom('deployments')
        .select(['network'])
        .where('address', '=', account.deployment_address)
        .executeTakeFirst();

      // Get incoming streams (where user is receiver)
      const incomingStreams = await db
        .selectFrom('streams')
        .selectAll()
        .where('deployment_address', '=', account.deployment_address)
        .where('receiver_id', '=', account.account_id)
        .where('active', '=', 1)
        .execute();

      // Get outgoing streams (where user is sender)
      const outgoingStreams = await db
        .selectFrom('streams')
        .selectAll()
        .where('deployment_address', '=', account.deployment_address)
        .where('sender_id', '=', account.account_id)
        .where('active', '=', 1)
        .execute();

      // Get splits config
      const splits = await db
        .selectFrom('splits')
        .selectAll()
        .where('deployment_address', '=', account.deployment_address)
        .where('account_id', '=', account.account_id)
        .execute();

      // Format incoming streams for UI
      const incoming = await Promise.all(incomingStreams.map(async (s) => {
        const decimals = await getTokenDecimals(s.fa_metadata);
        const rateInfo = formatRate(s.amt_per_sec, decimals);
        return {
          from: s.sender_id,
          rate: rateInfo.value,
          rateUnit: rateInfo.unit,
          streamId: s.stream_id,
        };
      }));

      // Format outgoing streams for UI
      const outgoing = await Promise.all(outgoingStreams.map(async (s) => {
        const decimals = await getTokenDecimals(s.fa_metadata);
        const rateInfo = formatRate(s.amt_per_sec, decimals);
        const now = Math.floor(Date.now() / 1000);
        // Use created_at timestamp if start_time is 0
        const createdAtTs = s.created_at ? Math.floor(new Date(s.created_at).getTime() / 1000) : now;
        const startTime = s.start_time || createdAtTs;
        const endTime = s.duration > 0 ? startTime + s.duration : 0;
        
        let durationText: string;
        if (!s.active) {
          const stoppedAt = s.updated_at ? Math.floor(new Date(s.updated_at).getTime() / 1000) : now;
          const ranFor = stoppedAt - startTime;
          durationText = ranFor > 0 ? formatDuration(ranFor) + ' (stopped)' : 'stopped';
        } else if (endTime > 0 && endTime > now) {
          durationText = formatDuration(endTime - now) + ' left';
        } else {
          const runningFor = now - startTime;
          durationText = runningFor > 60 ? formatDuration(runningFor) + ' running' : 'ongoing';
        }
        
        return {
          to: s.receiver_id,
          rate: rateInfo.value,
          rateUnit: rateInfo.unit,
          streamId: s.stream_id,
          durationText,
        };
      }));

      // Format splits for UI
      const splitsFormatted = splits.map(s => ({
        to: s.receiver_id,
        pct: Math.round((s.weight / 1_000_000) * 100),
        weight: s.weight,
      }));

      return {
        address: account.deployment_address,
        network: deployment?.network || 'Unknown',
        accountId: account.account_id,
        driverType: account.driver_type,
        // Balances - these would need to be fetched from chain in real implementation
        // For now, return placeholders that UI can display
        splittable: '0',
        collectable: '0', 
        streaming: '0',
        incoming,
        outgoing,
        splits: splitsFormatted,
      };
    }));

    res.json({
      address,
      accountId,
      deployments,
    });
  } catch (err) {
    next(err);
  }
});


// GET /users/:address/deployments - Which deployments user appears in
router.get('/:address/deployments', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;
    const accountId = calcAccountId(address).toString();

    const accounts = await db
      .selectFrom('accounts')
      .select(['deployment_address', 'account_id', 'driver_type'])
      .where((eb) =>
        eb.or([
          eb('wallet_address', '=', address),
          eb('account_id', '=', accountId),
        ])
      )
      .execute();

    const deploymentAddresses = [...new Set(accounts.map(a => a.deployment_address))];

    if (deploymentAddresses.length === 0) {
      return res.json([]);
    }

    const deployments = await db
      .selectFrom('deployments')
      .selectAll()
      .where('address', 'in', deploymentAddresses)
      .execute();

    res.json(deployments.map(d => ({
      address: d.address,
      network: d.network,
      firstSeenAt: d.first_seen_at,
    })));
  } catch (err) {
    next(err);
  }
});

export default router;
