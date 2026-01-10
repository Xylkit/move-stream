// Xylkit Contract Configuration
export const CONTRACT_ADDRESS =
  "0x1c5d264990c9a6791e78c10f4d354751e36164ec71f727ffdadb076fa1cdef0";

// Note: Wallet adapter uses DEVNET for compatibility, but our SDK client uses localnet
export const NODE_URL = "http://localhost:8080/v1";

// Drips Protocol Constants
export const CYCLE_SECS = 300; // 5 minutes
export const MIN_AMT_PER_SEC = 3333334;

// Module names
export const MODULES = {
  DRIPS: "drips",
  STREAMS: "streams",
  SPLITS: "splits",
  ADDRESS_DRIVER: "address_driver",
  NFT_DRIVER: "nft_driver",
  DRIVER_TRANSFER_UTILS: "driver_transfer_utils",
} as const;
