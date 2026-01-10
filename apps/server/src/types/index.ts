import { z } from 'zod';

// Event types from contracts
export type EventType =
  | 'StreamsSet'
  | 'SplitsSet'
  | 'Given'
  | 'Received'
  | 'Squeezed'
  | 'SplitExecuted'
  | 'Collected';

// API Response types
export interface DeploymentResponse {
  address: string;
  network: string;
  firstSeenAt: string;
  stats?: DeploymentStats;
}

export interface DeploymentStats {
  totalAccounts: number;
  activeStreams: number;
  totalSplits: number;
  totalEvents: number;
}

export interface AccountResponse {
  accountId: string;
  walletAddress: string | null;
  driverType: number;
  deploymentAddress: string;
}

export interface StreamResponse {
  senderId: string;
  receiverId: string;
  streamId: string;
  faMetadata: string;
  amtPerSec: string;
  startTime: number;
  duration: number;
  active: boolean;
}

export interface SplitResponse {
  accountId: string;
  receiverId: string;
  weight: number;
}

export interface EventResponse {
  id: number;
  eventType: string;
  accountId: string;
  data: Record<string, unknown>;
  txHash: string | null;
  timestamp: string;
}

export interface UserDeploymentInfo {
  deploymentAddress: string;
  accountId: string;
  driverType: number;
  activeStreamsOut: number;
  activeStreamsIn: number;
  splitsConfigured: number;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

// Validation schemas
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid hex address');

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
