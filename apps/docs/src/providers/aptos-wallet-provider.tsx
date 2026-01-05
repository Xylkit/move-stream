import type { ReactNode } from "react";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";

interface AptosWalletProviderProps {
  children: ReactNode;
}

export function AptosWalletProvider({ children }: AptosWalletProviderProps) {
  return (
    <AptosWalletAdapterProvider
      autoConnect={false}
      dappConfig={{
        network: Network.DEVNET, // Wallets need a recognized network
      }}
      onError={(error) => {
        console.error("Wallet error:", error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
