// Token/FA utilities

import { getDb } from "../database/connection.js";

const getRpcUrl = () =>
  process.env.MOVEMENT_RPC_URL || "https://aptos.testnet.porto.movementlabs.xyz/v1";

// Cache decimals in memory (these don't change)
const decimalsCache = new Map<string, number>();
const tokenMetadataCache = new Map<string, { symbol: string; name: string }>();

// Price cache TTL - 5 minutes
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

// Token ID mapping for CoinGecko
// Maps token addresses to CoinGecko IDs for price fetching
const COINGECKO_IDS: Record<string, string> = {
  // Native tokens
  "0xa": "movement", // Movement native token
  "0x0a": "movement", // Alternative format

  // Add more token mappings as needed
  // 'TOKEN_ADDRESS': 'coingecko-id',
};

/**
 * Fetch USD price for a token - checks DB first, fetches from CoinGecko if stale
 */
export async function getTokenPrice(faMetadata: string): Promise<number> {
  const db = getDb();
  const tokenId = faMetadata.toLowerCase();

  // Check DB for cached price
  const cached = await db
    .selectFrom("token_prices")
    .select(["price_usd", "updated_at"])
    .where("token_id", "=", tokenId)
    .executeTakeFirst();

  // If cached and fresh (< 5 min old), return it
  if (cached) {
    const age = Date.now() - new Date(cached.updated_at).getTime();
    if (age < PRICE_CACHE_TTL_MS) {
      return cached.price_usd;
    }
  }

  // Fetch fresh price from CoinGecko
  const geckoId = COINGECKO_IDS[faMetadata] || COINGECKO_IDS[tokenId];

  // If no CoinGecko mapping exists, try to get symbol from chain and use that
  if (!geckoId) {
    console.log(`[getTokenPrice] No CoinGecko mapping for ${faMetadata}, price will be 0`);
    const metadata = { symbol: "TOKEN", name: "Unknown Token" };
    const now = new Date().toISOString();
    await db
      .insertInto("token_prices")
      .values({ token_id: tokenId, symbol: metadata.symbol, price_usd: 0, updated_at: now })
      .onConflict((oc) =>
        oc.column("token_id").doUpdateSet({ price_usd: 0, updated_at: now })
      )
      .execute();
    return 0;
  }

  const symbol = geckoId; // Use geckoId as symbol for now

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      return cached?.price_usd || 0;
    }

    const data = (await response.json()) as Record<string, { usd: number }>;
    const price = data[geckoId]?.usd || 0;

    // Upsert to DB
    const now = new Date().toISOString();
    await db
      .insertInto("token_prices")
      .values({ token_id: tokenId, symbol, price_usd: price, updated_at: now })
      .onConflict((oc) =>
        oc.column("token_id").doUpdateSet({ price_usd: price, updated_at: now })
      )
      .execute();

    return price;
  } catch {
    return cached?.price_usd || 0;
  }
}

/**
 * Convert token amount to USD
 */
export async function toUsd(
  amount: bigint | string,
  faMetadata: string,
  decimals?: number
): Promise<number> {
  const tokenDecimals = decimals ?? (await getTokenDecimals(faMetadata));
  const price = await getTokenPrice(faMetadata);
  const raw = typeof amount === "string" ? BigInt(amount) : amount;
  const tokenAmount = Number(raw) / Math.pow(10, tokenDecimals);
  return tokenAmount * price;
}

/**
 * Format USD amount
 */
export function formatUsd(amount: number): string {
  if (amount < 0.01) return "<$0.01";
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 1000) return `$${amount.toFixed(2)}`;
  if (amount < 1_000_000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${(amount / 1_000_000).toFixed(2)}M`;
}

/**
 * Ensure token metadata exists in database
 * Fetches from chain if not present, stores for future use
 */
export async function ensureToken(
  faMetadata: string
): Promise<{ symbol: string; name: string; decimals: number }> {
  const db = getDb();

  // Check DB first
  const existing = await db
    .selectFrom("tokens")
    .selectAll()
    .where("address", "=", faMetadata)
    .executeTakeFirst();

  if (existing) {
    return {
      symbol: existing.symbol,
      name: existing.name,
      decimals: existing.decimals,
    };
  }

  // Not in DB, fetch from chain
  console.log(`[ensureToken] Fetching metadata for ${faMetadata} from chain`);

  try {
    const response = await fetch(
      `${getRpcUrl()}/accounts/${faMetadata}/resource/0x1::fungible_asset::Metadata`
    );

    if (!response.ok) {
      console.log(`[ensureToken] RPC call failed with status:`, response.status);
      // Store fallback in DB
      const fallback = { symbol: "TOKEN", name: "Unknown Token", decimals: 8 };
      await db
        .insertInto("tokens")
        .values({
          address: faMetadata,
          symbol: fallback.symbol,
          name: fallback.name,
          decimals: fallback.decimals,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
      return fallback;
    }

    const data = (await response.json()) as {
      data: {
        symbol: string;
        name: string;
        decimals: number;
      };
    };

    const metadata = {
      symbol: data.data.symbol || "TOKEN",
      name: data.data.name || "Unknown Token",
      decimals: data.data.decimals || 8,
    };

    console.log(`[ensureToken] Fetched and storing:`, metadata);

    // Store in DB
    await db
      .insertInto("tokens")
      .values({
        address: faMetadata,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    return metadata;
  } catch (err) {
    console.error(`[ensureToken] Failed to fetch token metadata for ${faMetadata}:`, err);
    // Store fallback in DB
    const fallback = { symbol: "TOKEN", name: "Unknown Token", decimals: 8 };
    await db
      .insertInto("tokens")
      .values({
        address: faMetadata,
        symbol: fallback.symbol,
        name: fallback.name,
        decimals: fallback.decimals,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();
    return fallback;
  }
}

/**
 * Get token metadata (symbol and name only)
 * Uses DB, no RPC calls after first fetch
 */
export async function getTokenMetadata(
  faMetadata: string
): Promise<{ symbol: string; name: string }> {
  const token = await ensureToken(faMetadata);
  return { symbol: token.symbol, name: token.name };
}

/**
 * Get token decimals
 * Uses DB, no RPC calls after first fetch
 */
export async function getTokenDecimals(faMetadata: string): Promise<number> {
  const token = await ensureToken(faMetadata);
  return token.decimals;
}

/**
 * Format amount with proper decimals
 * @param amount Raw amount (in smallest units)
 * @param decimals Token decimals
 * @param displayDecimals How many decimals to show (default 4)
 */
export function formatAmount(
  amount: bigint | string,
  decimals: number,
  displayDecimals = 4
): string {
  const raw = typeof amount === "string" ? BigInt(amount) : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, displayDecimals);
  // Remove trailing zeros
  const trimmed = fractionStr.replace(/0+$/, "");

  if (trimmed === "") {
    return whole.toString();
  }

  return `${whole}.${trimmed}`;
}

/**
 * Format rate (amt_per_sec) to human readable with auto-scaling unit
 * amt_per_sec has 9 extra decimals on top of token decimals
 * Returns { value: string, unit: string, perSecond: number }
 */
export function formatRate(
  amtPerSec: string,
  tokenDecimals: number
): { value: string; unit: string; perSecond: number } {
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
    unit = "/mo";
  } else if (perDay < 1) {
    // Show per day with decimals
    value = perDay;
    unit = "/day";
  } else if (perDay < 100) {
    // Normal range - per day
    value = perDay;
    unit = "/day";
  } else if (perHour < 100) {
    // Fast - per hour
    value = perHour;
    unit = "/hr";
  } else if (perMinute < 100) {
    // Very fast - per minute
    value = perMinute;
    unit = "/min";
  } else {
    // Extremely fast - per second
    value = perSecond;
    unit = "/sec";
  }

  // Format value nicely
  const formatted =
    value < 0.01
      ? value.toExponential(2)
      : value < 1
      ? value.toFixed(4).replace(/\.?0+$/, "")
      : value < 100
      ? value.toFixed(2).replace(/\.?0+$/, "")
      : Math.round(value).toString();

  return { value: formatted, unit, perSecond };
}
