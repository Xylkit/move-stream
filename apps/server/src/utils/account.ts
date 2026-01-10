// Account ID calculation utilities

const DRIVER_ID_OFFSET = 224n;
const MASK = 0x00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

/**
 * Calculate account ID from wallet address
 * Account ID = driverId (32 bits) | walletAddress (224 bits)
 */
export function calcAccountId(address: string, driverId = 1): bigint {
  const addressBigInt = BigInt(address);
  return (BigInt(driverId) << DRIVER_ID_OFFSET) | (addressBigInt & MASK);
}

/**
 * Extract wallet address from account ID (for AddressDriver accounts)
 */
export function extractWalletAddress(accountId: string): string | null {
  try {
    const id = BigInt(accountId);
    const driverId = Number(id >> DRIVER_ID_OFFSET);
    
    // Only AddressDriver (1) has wallet address embedded
    if (driverId !== 1) return null;
    
    const address = id & MASK;
    return '0x' + address.toString(16).padStart(64, '0');
  } catch {
    return null;
  }
}

/**
 * Get driver type from account ID
 */
export function getDriverType(accountId: string): number {
  try {
    const id = BigInt(accountId);
    return Number(id >> DRIVER_ID_OFFSET);
  } catch {
    return 0;
  }
}

/**
 * Fetch NFT owner from chain (for NFTDriver accounts)
 */
export async function fetchNftOwner(deploymentAddress: string, accountId: string): Promise<string | null> {
  const rpcUrl = process.env.MOVEMENT_RPC_URL || 'https://aptos.testnet.porto.movementlabs.xyz/v1';
  
  try {
    const response = await fetch(`${rpcUrl}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function: `${deploymentAddress}::nft_driver::owner_of`,
        type_arguments: [],
        arguments: [accountId],
      }),
    });
    
    if (!response.ok) return null;
    
    const result = await response.json() as string[];
    return result[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get wallet address for any account type
 * - AddressDriver: Extract from account ID
 * - NFTDriver: Query chain for owner
 */
export async function getWalletAddress(
  deploymentAddress: string, 
  accountId: string
): Promise<string | null> {
  const driverType = getDriverType(accountId);
  
  if (driverType === 1) {
    // AddressDriver - extract from ID
    return extractWalletAddress(accountId);
  } else if (driverType === 2) {
    // NFTDriver - query chain
    return fetchNftOwner(deploymentAddress, accountId);
  }
  
  return null;
}
