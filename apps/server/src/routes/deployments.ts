import express from 'express';
import { sql } from 'kysely';
import { getDb } from '../database/connection.js';
import { NotFoundError } from '../utils/errors.js';
import { getTokenDecimals, formatRate, formatAmount, getTokenPrice, toUsd, formatUsd } from '../utils/token.js';

// Format duration in seconds to human readable
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

const router = express.Router();

// GET /deployments - List deployments (supports random selection)
// Query params:
//   ?limit=6 - max number to return (default 6, max 20)
//   ?random=true - randomize order (default true)
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 6, 20);
    const random = req.query.random !== 'false'; // default true

    let query = db.selectFrom('deployments').selectAll();
    
    if (random) {
      // SQLite/Turso RANDOM() for random ordering
      query = query.orderBy(sql`RANDOM()`);
    } else {
      query = query.orderBy('first_seen_at', 'desc');
    }
    
    const deployments = await query.limit(limit).execute();

    // Get stats for each deployment
    const response = await Promise.all(deployments.map(async (d) => {
      const stats = await getDeploymentStats(d.address);
      return {
        address: d.address,
        network: 'Movement Testnet',
        firstSeenAt: d.first_seen_at,
        volume: stats.totalVolume,
        volumeUsd: stats.totalVolumeUsd,
        tvl: stats.tvl,
        tvlUsd: stats.tvlUsd,
        streams: stats.activeStreams,
        accounts: stats.totalAccounts,
      };
    }));

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// GET /deployments/:address - Single deployment with stats
router.get('/:address', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;

    const deployment = await db
      .selectFrom('deployments')
      .selectAll()
      .where('address', '=', address)
      .executeTakeFirst();

    if (!deployment) {
      throw new NotFoundError('Deployment not found', { address });
    }

    const stats = await getDeploymentStats(address);

    res.json({
      address: deployment.address,
      network: deployment.network,
      firstSeenAt: deployment.first_seen_at,
      stats,
    });
  } catch (err) {
    next(err);
  }
});


interface DeploymentStats {
  totalAccounts: number;
  activeStreams: number;
  totalSplits: number;
  totalEvents: number;
  totalVolume: string;
  totalVolumeUsd: string;
  tvl: string;
  tvlUsd: string;
}

async function getDeploymentStats(address: string): Promise<DeploymentStats> {
  const db = getDb();
  const [accounts, streams, splits, events] = await Promise.all([
    db.selectFrom('accounts').select(db.fn.countAll().as('count'))
      .where('deployment_address', '=', address).executeTakeFirst(),
    db.selectFrom('streams').select(db.fn.countAll().as('count'))
      .where('deployment_address', '=', address).where('active', '=', 1).executeTakeFirst(),
    db.selectFrom('splits').select(db.fn.countAll().as('count'))
      .where('deployment_address', '=', address).executeTakeFirst(),
    db.selectFrom('events').select(db.fn.countAll().as('count'))
      .where('deployment_address', '=', address).executeTakeFirst(),
  ]);

  // Calculate total volume from events (Given, Collected, StreamsSet deposits)
  const volumeEvents = await db
    .selectFrom('events')
    .select(['event_type', 'data'])
    .where('deployment_address', '=', address)
    .where('event_type', 'in', ['Given', 'Collected', 'Received', 'Squeezed'])
    .execute();

  let totalVolumeRaw = 0n;
  let faMetadata = '0xa'; // Default to APT
  
  for (const e of volumeEvents) {
    try {
      const data = JSON.parse(e.data);
      if (data.amount) {
        totalVolumeRaw += BigInt(data.amount);
      }
      if (data.fa_metadata) {
        faMetadata = data.fa_metadata;
      }
    } catch { /* skip */ }
  }
  
  // Calculate TVL from active streams balances
  const streamsSetEvents = await db
    .selectFrom('events')
    .select(['data'])
    .where('deployment_address', '=', address)
    .where('event_type', '=', 'StreamsSet')
    .orderBy('timestamp', 'desc')
    .execute();

  // Sum up latest balance per account
  const accountBalances = new Map<string, bigint>();
  for (const e of streamsSetEvents) {
    try {
      const data = JSON.parse(e.data);
      if (data.account_id && data.balance) {
        // Only keep first (latest) balance per account
        if (!accountBalances.has(data.account_id)) {
          accountBalances.set(data.account_id, BigInt(data.balance));
        }
      }
    } catch { /* skip */ }
  }
  
  let tvlRaw = 0n;
  for (const balance of accountBalances.values()) {
    tvlRaw += balance;
  }

  const decimals = await getTokenDecimals(faMetadata);
  const totalVolume = formatAmount(totalVolumeRaw, decimals, 2);
  const tvl = formatAmount(tvlRaw, decimals, 2);
  
  // Get USD values
  const volumeUsd = await toUsd(totalVolumeRaw, faMetadata, decimals);
  const tvlUsdValue = await toUsd(tvlRaw, faMetadata, decimals);

  return {
    totalAccounts: Number(accounts?.count || 0),
    activeStreams: Number(streams?.count || 0),
    totalSplits: Number(splits?.count || 0),
    totalEvents: Number(events?.count || 0),
    totalVolume,
    totalVolumeUsd: formatUsd(volumeUsd),
    tvl,
    tvlUsd: formatUsd(tvlUsdValue),
  };
}

// GET /deployments/:address/streams - All streams in deployment
// Returns data formatted for UI: from, to, rate, balance, days remaining
router.get('/:address/streams', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;
    const activeOnly = req.query.active !== 'false';

    let query = db
      .selectFrom('streams')
      .selectAll()
      .where('deployment_address', '=', address);

    if (activeOnly) {
      query = query.where('active', '=', 1);
    }

    const streams = await query.execute();

    // Format for UI with dynamic decimals
    const formatted = await Promise.all(streams.map(async (s) => {
      const decimals = await getTokenDecimals(s.fa_metadata);
      const rateInfo = formatRate(s.amt_per_sec, decimals);
      
      // Calculate timing info
      const now = Math.floor(Date.now() / 1000);
      // Use created_at timestamp if start_time is 0
      const createdAtTs = s.created_at ? Math.floor(new Date(s.created_at).getTime() / 1000) : now;
      const startTime = s.start_time || createdAtTs;
      const endTime = s.duration > 0 ? startTime + s.duration : 0;
      
      let durationText: string;
      if (!s.active) {
        // Stopped stream - calculate how long it ran using updated_at as stop time
        const stoppedAt = s.updated_at ? Math.floor(new Date(s.updated_at).getTime() / 1000) : now;
        const ranFor = stoppedAt - startTime;
        durationText = ranFor > 0 ? formatDuration(ranFor) + ' (stopped)' : 'stopped';
      } else if (endTime > 0 && endTime > now) {
        // Active with end time
        durationText = formatDuration(endTime - now) + ' left';
      } else {
        // Ongoing (no end time) - show how long it's been running
        const runningFor = now - startTime;
        durationText = runningFor > 60 ? formatDuration(runningFor) + ' running' : 'ongoing';
      }

      return {
        from: s.sender_id,
        to: s.receiver_id,
        streamId: s.stream_id,
        faMetadata: s.fa_metadata,
        rate: rateInfo.value,
        rateUnit: rateInfo.unit,
        amtPerSec: s.amt_per_sec,
        startTime: s.start_time,
        duration: s.duration,
        durationText,
        active: s.active === 1,
      };
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
});


// GET /deployments/:address/splits - All splits configs
// Returns data formatted for UI: accountId, receivers with percentages
router.get('/:address/splits', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;

    const splits = await db
      .selectFrom('splits')
      .selectAll()
      .where('deployment_address', '=', address)
      .execute();

    // Group by account_id
    const grouped = new Map<string, Array<{ to: string; weight: number; pct: number }>>();
    
    for (const s of splits) {
      if (!grouped.has(s.account_id)) {
        grouped.set(s.account_id, []);
      }
      // Weight is out of 1,000,000 (100%)
      const pct = Math.round((s.weight / 1_000_000) * 100);
      grouped.get(s.account_id)!.push({
        to: s.receiver_id,
        weight: s.weight,
        pct,
      });
    }

    const result = Array.from(grouped.entries()).map(([accountId, receivers]) => ({
      accountId,
      receivers,
      totalPct: receivers.reduce((sum, r) => sum + r.pct, 0),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /deployments/:address/accounts - All accounts
router.get('/:address/accounts', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;

    const accounts = await db
      .selectFrom('accounts')
      .selectAll()
      .where('deployment_address', '=', address)
      .execute();

    res.json(accounts.map(a => ({
      accountId: a.account_id,
      walletAddress: a.wallet_address,
      driverType: a.driver_type,
    })));
  } catch (err) {
    next(err);
  }
});

// GET /deployments/:address/events - Activity feed
router.get('/:address/events', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const events = await db
      .selectFrom('events')
      .selectAll()
      .where('deployment_address', '=', address)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json(events.map(e => ({
      id: e.id,
      eventType: e.event_type,
      accountId: e.account_id,
      data: JSON.parse(e.data),
      txHash: e.tx_hash,
      timestamp: e.timestamp,
    })));
  } catch (err) {
    next(err);
  }
});

// GET /deployments/:address/vault - Token balances in the vault
router.get('/:address/vault', async (req, res, next) => {
  try {
    const db = getDb();
    const { address } = req.params;

    // Get all StreamsSet events to track balances per token
    const streamsSetEvents = await db
      .selectFrom('events')
      .select(['data'])
      .where('deployment_address', '=', address)
      .where('event_type', '=', 'StreamsSet')
      .orderBy('timestamp', 'desc')
      .execute();

    // Track latest balance per account per token
    const tokenBalances = new Map<string, Map<string, bigint>>(); // token -> (account -> balance)
    
    for (const e of streamsSetEvents) {
      try {
        const data = JSON.parse(e.data);
        const token = data.fa_metadata || '0xa';
        const accountId = data.account_id;
        const balance = BigInt(data.balance || '0');
        
        if (!tokenBalances.has(token)) {
          tokenBalances.set(token, new Map());
        }
        const accountMap = tokenBalances.get(token)!;
        
        // Only keep first (latest) balance per account
        if (!accountMap.has(accountId)) {
          accountMap.set(accountId, balance);
        }
      } catch { /* skip */ }
    }

    // Aggregate per token
    const vault = await Promise.all(
      Array.from(tokenBalances.entries()).map(async ([token, accounts]) => {
        let totalRaw = 0n;
        for (const balance of accounts.values()) {
          totalRaw += balance;
        }
        
        const decimals = await getTokenDecimals(token);
        const amount = formatAmount(totalRaw, decimals, 4);
        const usdValue = await toUsd(totalRaw, token, decimals);
        
        // Get token symbol (simplified - APT for now)
        const symbol = token === '0xa' || token.endsWith('0a') ? 'APT' : 'TOKEN';
        
        return {
          token,
          symbol,
          amount,
          amountRaw: totalRaw.toString(),
          usd: formatUsd(usdValue),
          usdValue,
          holders: accounts.size,
        };
      })
    );

    // Sort by USD value descending
    vault.sort((a, b) => b.usdValue - a.usdValue);

    res.json(vault);
  } catch (err) {
    next(err);
  }
});

export default router;
