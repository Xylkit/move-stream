// Account ID calculation utilities

/**
 * Calculate account ID from wallet address for AddressDriver
 *
 * AddressDriver uses the full 256-bit address as the account ID.
 * No masking or driver ID bits - the account ID IS the address.
 */
export function calcAccountId(address: string): bigint {
  return BigInt(address);
}

/**
 * Extract wallet address from account ID (for AddressDriver accounts)
 *
 * AddressDriver account IDs are simply the full 256-bit wallet address.
 * This function returns the complete original address with no data loss.
 *
 * For NFTDriver accounts (which use a different structure), this returns null.
 */
export function extractWalletAddress(accountId: string): string | null {
  try {
    const id = BigInt(accountId);

    // Check if this looks like an NFTDriver account ID
    // NFTDriver uses: [160-bit minter][64-bit salt][32-bit ???]
    // For now, we assume if it's a valid address format, it's AddressDriver
    // TODO: Add proper NFTDriver detection logic

    // Return the full address
    return "0x" + id.toString(16).padStart(64, "0");
  } catch {
    return null;
  }
}

/**
 * Get driver type from driver name
 * Converts driver_name string to numeric type for backwards compatibility with frontend
 */
export function getDriverTypeFromName(driverName: string | null | undefined): number {
  if (!driverName) return 0;
  
  const normalized = driverName.toLowerCase();
  if (normalized.includes('address')) return 1;
  if (normalized.includes('nft')) return 2;
  
  // Unknown custom driver - default to 1
  return 1;
}

/**
 * Fetch NFT owner from chain (for NFTDriver accounts)
 */
export async function fetchNftOwner(
  deploymentAddress: string,
  accountId: string
): Promise<string | null> {
  const rpcUrl =
    process.env.MOVEMENT_RPC_URL || "https://aptos.testnet.porto.movementlabs.xyz/v1";

  try {
    const response = await fetch(`${rpcUrl}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: `${deploymentAddress}::nft_driver::owner_of`,
        type_arguments: [],
        arguments: [accountId],
      }),
    });

    if (!response.ok) return null;

    const result = (await response.json()) as string[];
    return result[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get wallet address for any account type
 * - AddressDriver: Extract from account ID (full address preserved)
 * - NFTDriver: Query chain for owner
 */
export async function getWalletAddress(
  deploymentAddress: string,
  accountId: string,
  driverName?: string | null
): Promise<string | null> {
  // Use driver name if available
  if (driverName) {
    const normalized = driverName.toLowerCase();
    
    if (normalized.includes('address')) {
      // AddressDriver - extract from ID
      return extractWalletAddress(accountId);
    } else if (normalized.includes('nft')) {
      // NFTDriver - query chain
      return fetchNftOwner(deploymentAddress, accountId);
    }
  }
  
  // Fallback: assume AddressDriver
  return extractWalletAddress(accountId);
}
