// Token/FA utilities

import { getDb } from '../database/connection.js';

const getRpcUrl = () => process.env.MOVEMENT_RPC_URL || 'https://aptos.testnet.porto.movementlabs.xyz/v1';

// Cache decimals in memory (these don't change)
const decimalsCache = new Map<string, number>();

// Price cache TTL - 5 minutes
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

// Token ID mapping for CoinGecko
const COINGECKO_IDS: Record<string, string> = {
  '0xa': 'aptos',
  '0x0a': 'aptos',
  'APT': 'aptos',
};

/**
 * Fetch USD price for a token - checks DB first, fetches from CoinGecko if stale
 */
export async function getTokenPrice(faMetadata: string): Promise<number> {
  const db = getDb();
  const tokenId = faMetadata.toLowerCase();
  
  // Check DB for cached price
  const cached = await db
    .selectFrom('token_prices')
    .select(['price_usd', 'updated_at'])
    .where('token_id', '=', tokenId)
    .executeTakeFirst();

  // If cached and fresh (< 5 min old), return it
  if (cached) {
    const age = Date.now() - new Date(cached.updated_at).getTime();
    if (age < PRICE_CACHE_TTL_MS) {
      return cached.price_usd;
    }
  }

  // Fetch fresh price from CoinGecko
  const geckoId = COINGECKO_IDS[faMetadata] || COINGECKO_IDS[tokenId] || 'aptos';
  const symbol = geckoId === 'aptos' ? 'APT' : 'TOKEN';
  
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) {
      return cached?.price_usd || 0;
    }

    const data = await response.json() as Record<string, { usd: number }>;
    const price = data[geckoId]?.usd || 0;
    
    // Upsert to DB
    const now = new Date().toISOString();
    await db
      .insertInto('token_prices')
      .values({ token_id: tokenId, symbol, price_usd: price, updated_at: now })
      .onConflict((oc) => oc.column('token_id').doUpdateSet({ price_usd: price, updated_at: now }))
      .execute();
    
    return price;
  } catch {
    return cached?.price_usd || 0;
  }
}

/**
 * Convert token amount to USD
 */
export async function toUsd(amount: bigint | string, faMetadata: string, decimals?: number): Promise<number> {
  const tokenDecimals = decimals ?? await getTokenDecimals(faMetadata);
  const price = await getTokenPrice(faMetadata);
  const raw = typeof amount === 'string' ? BigInt(amount) : amount;
  const tokenAmount = Number(raw) / Math.pow(10, tokenDecimals);
  return tokenAmount * price;
}

/**
 * Format USD amount
 */
export function formatUsd(amount: number): string {
  if (amount < 0.01) return '<$0.01';
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 1000) return `$${amount.toFixed(2)}`;
  if (amount < 1_000_000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${(amount / 1_000_000).toFixed(2)}M`;
}

/**
 * Fetch decimals for a fungible asset from chain
 */
export async function getTokenDecimals(faMetadata: string): Promise<number> {
  // Check cache first
  if (decimalsCache.has(faMetadata)) {
    return decimalsCache.get(faMetadata)!;
  }

  // Default to 8 for APT (0xa)
  if (faMetadata === '0xa' || faMetadata === '0x0a' || faMetadata === '0x000000000000000000000000000000000000000000000000000000000000000a') {
    decimalsCache.set(faMetadata, 8);
    return 8;
  }

  try {
    // Query the FA metadata resource
    const response = await fetch(`${getRpcUrl()}/accounts/${faMetadata}/resource/0x1::fungible_asset::Metadata`);
    
    if (!response.ok) {
      // Fallback to 8 decimals
      decimalsCache.set(faMetadata, 8);
      return 8;
    }

    const data = await response.json() as { data: { decimals: number } };
    const decimals = data.data.decimals;
    
    decimalsCache.set(faMetadata, decimals);
    return decimals;
  } catch {
    // Fallback to 8 decimals
    decimalsCache.set(faMetadata, 8);
    return 8;
  }
}

/**
 * Format amount with proper decimals
 * @param amount Raw amount (in smallest units)
 * @param decimals Token decimals
 * @param displayDecimals How many decimals to show (default 4)
 */
export function formatAmount(amount: bigint | string, decimals: number, displayDecimals = 4): string {
  const raw = typeof amount === 'string' ? BigInt(amount) : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  
  if (fraction === 0n) {
    return whole.toString();
  }
  
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, displayDecimals);
  // Remove trailing zeros
  const trimmed = fractionStr.replace(/0+$/, '');
  
  if (trimmed === '') {
    return whole.toString();
  }
  
  return `${whole}.${trimmed}`;
}

/**
 * Format rate (amt_per_sec) to human readable with auto-scaling unit
 * amt_per_sec has 9 extra decimals on top of token decimals
 * Returns { value: string, unit: string, perSecond: number }
 */
export function formatRate(amtPerSec: string, tokenDecimals: number): { value: string; unit: string; perSecond: number } {
  const raw = BigInt(amtPerSec);
  const totalDecimals = 9 + tokenDecimals;
  const divisor = 10n ** BigInt(totalDecimals);
  
  // Calculate per second as float for comparison
  const perSecond = Number(raw) / Number(divisor);
  
  // Calculate for different time units
  const perMinute = perSecond * 60;
  const perHour = perSecond * 3600;
  const perDay = perSecond * 86400;
  
  // Auto-scale based on magnitude
  let value: number;
  let unit: string;
  
  if (perDay < 0.01) {
    // Very slow - show per month
    value = perDay * 30;
    unit = '/mo';
  } else if (perDay < 1) {
    // Show per day with decimals
    value = perDay;
    unit = '/day';
  } else if (perDay < 100) {
    // Normal range - per day
    value = perDay;
    unit = '/day';
  } else if (perHour < 100) {
    // Fast - per hour
    value = perHour;
    unit = '/hr';
  } else if (perMinute < 100) {
    // Very fast - per minute
    value = perMinute;
    unit = '/min';
  } else {
    // Extremely fast - per second
    value = perSecond;
    unit = '/sec';
  }
  
  // Format value nicely
  const formatted = value < 0.01 
    ? value.toExponential(2)
    : value < 1 
      ? value.toFixed(4).replace(/\.?0+$/, '')
      : value < 100
        ? value.toFixed(2).replace(/\.?0+$/, '')
        : Math.round(value).toString();
  
  return { value: formatted, unit, perSecond };
}
