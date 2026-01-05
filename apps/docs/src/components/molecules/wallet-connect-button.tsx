import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Button } from "@/components/atoms/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/atoms/dropdown-menu";
import { ellipsisAddress } from "@/utils";
import { ExternalLink } from "lucide-react";

export function WalletConnectButton() {
  const { connect, disconnect, account, wallets, connected } = useWallet();

  if (connected && account) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {ellipsisAddress(account.address.toString())}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={disconnect}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (wallets.length === 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Install Wallet
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="p-2 text-sm text-muted-foreground">
            No Aptos wallet detected
          </div>
          <DropdownMenuItem asChild>
            <a
              href="https://petra.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between"
            >
              Install Petra Wallet
              <ExternalLink className="h-4 w-4" />
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm">
          Connect Wallet
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {wallets.map((wallet) => (
          <DropdownMenuItem
            key={wallet.name}
            onClick={() => connect(wallet.name)}
          >
            <div className="flex items-center gap-2">
              {wallet.icon && (
                <img src={wallet.icon} alt={wallet.name} className="w-5 h-5" />
              )}
              {wallet.name}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
