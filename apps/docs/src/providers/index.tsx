import type { ReactNode } from "react";
import { AptosWalletProvider } from "./aptos-wallet-provider";
import { ThemeProvider } from "./theme-provider";

interface RootProviderProps {
  children: ReactNode;
}

export default function RootProvider({ children }: RootProviderProps) {
  return (
    <ThemeProvider>
      <AptosWalletProvider>{children}</AptosWalletProvider>
    </ThemeProvider>
  );
}
