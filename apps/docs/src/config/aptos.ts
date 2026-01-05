import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { NODE_URL, CYCLE_SECS } from "./constants";

// Configure Aptos client for localnet
const config = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: NODE_URL,
});

export const aptos = new Aptos(config);

// Helper to get current cycle
export function getCurrentCycle(): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor(now / CYCLE_SECS);
}

// Helper to get time remaining in current cycle
export function getTimeRemainingInCycle(): number {
  const now = Math.floor(Date.now() / 1000);
  return CYCLE_SECS - (now % CYCLE_SECS);
}

// Format APT amount (from octas)
export function formatAPT(octas: string | number): string {
  const amount = Number(octas) / 100_000_000;
  return amount.toFixed(4);
}

// Format amount per second (with 9 decimals)
export function formatAmtPerSec(amtPerSec: string | number): string {
  const amount = Number(amtPerSec) / 1_000_000_000;
  return amount.toFixed(9);
}

// Convert amount per second to raw value (add 9 decimals)
export function toAmtPerSec(amount: number): number {
  return Math.floor(amount * 1_000_000_000);
}
