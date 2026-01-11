const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Types
export interface Deployment {
  address: string;
  network: string;
  firstSeenAt: string;
  volume: string;
  volumeUsd: string;
  tvl: string;
  tvlUsd: string;
  streams: number;
  accounts: number;
  stats?: {
    totalAccounts: number;
    activeStreams: number;
    totalSplits: number;
    totalEvents: number;
    totalVolume: string;
    totalVolumeUsd: string;
    tvl: string;
    tvlUsd: string;
  };
}

export interface Stream {
  from: string;
  to: string;
  streamId: string;
  faMetadata: string;
  rate: string;
  rateUnit: string;
  amtPerSec: string;
  startTime: number;
  duration: number;
  durationText: string;
  active: boolean;
}

export interface Split {
  to: string;
  pct: number;
  weight: number;
}

export interface UserDeployment {
  address: string;
  network: string;
  accountId: string;
  driverType: number;
  splittable: string;
  collectable: string;
  streaming: string;
  incoming: Array<{ from: string; rate: string; rateUnit: string; streamId: string }>;
  outgoing: Array<{ to: string; rate: string; rateUnit: string; streamId: string; durationText: string }>;
  splits: Split[];
}

export interface SyncStatus {
  deployment: string;
  lastSyncedAt: string | null;
  ageMs: number;
}

// API functions
export async function searchAddress(q: string): Promise<{ 
  type: 'deployment' | 'user'; 
  address: string;
  deploymentsDiscovered?: number;
  discoveryProgress?: {
    processed: number;
    hasMore: boolean;
    batchSize: number;
  };
}> {
  const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

export async function getDeployments(options: { limit?: number; random?: boolean } = {}): Promise<Deployment[]> {
  const { limit = 6, random = true } = options;
  const params = new URLSearchParams();
  params.set('limit', limit.toString());
  params.set('random', random.toString());
  
  const res = await fetch(`${API_URL}/deployments?${params}`);
  if (!res.ok) throw new Error('Failed to fetch deployments');
  return res.json();
}

export async function getDeployment(address: string): Promise<Deployment> {
  const res = await fetch(`${API_URL}/deployments/${address}`);
  if (!res.ok) throw new Error('Deployment not found');
  return res.json();
}

export async function getDeploymentStreams(address: string, activeOnly = false): Promise<Stream[]> {
  const url = activeOnly 
    ? `${API_URL}/deployments/${address}/streams?active=true`
    : `${API_URL}/deployments/${address}/streams?active=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch streams');
  return res.json();
}

export interface SplitConfig {
  accountId: string;
  receivers: Array<{ to: string; weight: number; pct: number }>;
  totalPct: number;
}

export interface Account {
  accountId: string;
  walletAddress: string | null;
  driverType: number;
}

export async function getDeploymentSplits(address: string): Promise<SplitConfig[]> {
  const res = await fetch(`${API_URL}/deployments/${address}/splits`);
  if (!res.ok) throw new Error('Failed to fetch splits');
  return res.json();
}

export async function getDeploymentAccounts(address: string): Promise<Account[]> {
  const res = await fetch(`${API_URL}/deployments/${address}/accounts`);
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return res.json();
}

export interface ActivityEvent {
  id: number;
  eventType: string;
  accountId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export async function getDeploymentActivity(address: string, limit = 50): Promise<ActivityEvent[]> {
  const res = await fetch(`${API_URL}/deployments/${address}/events?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch activity');
  return res.json();
}

export interface VaultToken {
  token: string;
  symbol: string;
  amount: string;
  amountRaw: string;
  usd: string;
  usdValue: number;
  holders: number;
}

export async function getDeploymentVault(address: string): Promise<VaultToken[]> {
  const res = await fetch(`${API_URL}/deployments/${address}/vault`);
  if (!res.ok) throw new Error('Failed to fetch vault');
  return res.json();
}

export async function getUser(address: string): Promise<{ address: string; accountId: string; deployments: UserDeployment[] }> {
  const res = await fetch(`${API_URL}/users/${address}`);
  if (!res.ok) throw new Error('Failed to fetch user');
  return res.json();
}

export async function triggerSync(options: { deployment?: string; user?: string; force?: boolean } = {}): Promise<{
  success: boolean;
  eventsProcessed: number;
  skipped: boolean;
  lastSyncedAt: string;
  hasMore?: boolean;
  cursor?: string;
}> {
  const res = await fetch(`${API_URL}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error('Sync failed');
  return res.json();
}

export async function getSyncStatus(deployment?: string): Promise<{ status: SyncStatus[]; anyStale: boolean }> {
  const url = deployment ? `${API_URL}/sync/status?deployment=${deployment}` : `${API_URL}/sync/status`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch sync status');
  return res.json();
}

// Helper to format time ago
export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3600_000)}h ago`;
}

