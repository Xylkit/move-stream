import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getDeployment,
  getDeploymentAccounts,
  getDeploymentActivity,
  getDeploymentSplits,
  getDeploymentStreams,
  getDeploymentVault,
  getSyncStatus,
  timeAgo,
  triggerSync,
  type Account,
  type ActivityEvent,
  type Deployment,
  type SplitConfig,
  type Stream,
  type VaultToken,
} from "../../lib/api";

export const Route = createFileRoute("/explorer/d/$address")({
  component: DeploymentView,
});

type Tab = "activity" | "vault" | "accounts";

function DeploymentView() {
  const { address } = Route.useParams();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [splits, setSplits] = useState<SplitConfig[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [vault, setVault] = useState<VaultToken[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("activity");

  // Create a mapping from account ID to wallet address
  const accountIdToWallet = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((acc) => {
      if (acc.walletAddress) {
        map.set(acc.accountId, acc.walletAddress);
      }
    });
    return map;
  }, [accounts]);

  // Helper to get wallet address from account ID, fallback to account ID
  const getWalletAddress = (accountId: string): string => {
    return accountIdToWallet.get(accountId) || accountId;
  };

  // Helper to format address for display
  const formatAddress = (address: string, length = 10): string => {
    if (address.length <= length + 4) return address;
    return `${address.slice(0, length)}...${address.slice(-4)}`;
  };

  const loadData = async () => {
    try {
      const [dep, str, spl, acc, act, vlt, status] = await Promise.all([
        getDeployment(address),
        getDeploymentStreams(address, false),
        getDeploymentSplits(address),
        getDeploymentAccounts(address),
        getDeploymentActivity(address),
        getDeploymentVault(address),
        getSyncStatus(address),
      ]);
      setDeployment(dep);
      setStreams(str);
      setSplits(spl);
      setAccounts(acc);
      setActivity(act);
      setVault(vlt);
      setLastSynced(status.status[0]?.lastSyncedAt || null);
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (): Promise<boolean> => {
    setSyncing(true);
    try {
      const result = await triggerSync({ deployment: address });
      console.log(`[Deployment] Sync result:`, result);

      // If more data to sync, auto-continue
      if (result.hasMore) {
        console.log(
          `[Deployment] Sync progress: ${result.eventsProcessed} events, cursor at ${result.cursor}, continuing...`,
        );
        await loadData(); // Refresh UI with new data
        setTimeout(() => handleSync(), 500); // Continue after 500ms
        return true; // Still syncing
      }

      console.log(`[Deployment] Sync complete: ${result.eventsProcessed} events`);
      await loadData();
      setSyncing(false);
      return false; // Done
    } catch (err) {
      console.error("[Deployment] Sync failed:", err);
      setSyncing(false);
      return false;
    }
  };

  useEffect(() => {
    // Load existing data immediately, then start syncing
    const init = async () => {
      await loadData(); // Show existing data (or empty state)
      handleSync(); // Start background sync (don't await - let it run)
    };
    init();

    const interval = setInterval(async () => {
      const status = await getSyncStatus(address);
      setLastSynced(status.status[0]?.lastSyncedAt || null);
    }, 30_000);
    return () => clearInterval(interval);
  }, [address]);

  if (loading) {
    return <div className="w-full max-w-5xl mx-auto mt-12 text-slate-500">Loading...</div>;
  }

  const activeStreams = streams.filter((s) => s.active);

  return (
    <div className="w-full max-w-5xl mx-auto mt-12 pb-20 animate-fade-in-up">
      <Link
        to="/explorer"
        className="text-slate-500 hover:text-white text-sm mb-6 flex items-center gap-2 transition-colors focus:outline-none rounded"
      >
        ← Back to search
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-serif text-white mb-2">Deployment</h2>
          <p className="text-slate-500 font-mono text-sm">{address}</p>
          <p className="text-cyan-400 text-xs mt-1">Movement Testnet</p>
        </div>
        <div className="text-right">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors disabled:opacity-50 focus:outline-none"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <p className="text-slate-600 text-xs mt-1">indexed {timeAgo(lastSynced)}</p>
        </div>
      </div>

      {/* Stats Bar - 4 columns on desktop, 2x2 on mobile */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-xl font-light text-cyan-400">
            {deployment?.stats?.tvlUsd || "$0"}
          </p>
          <p className="text-slate-500 text-xs mt-1">TVL</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-xl font-light text-white">
            {deployment?.stats?.totalVolumeUsd || "$0"}
          </p>
          <p className="text-slate-500 text-xs mt-1">Volume</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-xl font-light text-white">{activeStreams.length}</p>
          <p className="text-slate-500 text-xs mt-1">Active Streams</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-xl font-light text-white">{accounts.length}</p>
          <p className="text-slate-500 text-xs mt-1">Accounts</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-white/[0.02] rounded-full w-fit">
        {(["activity", "vault", "accounts"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-full text-sm transition-all capitalize focus:outline-none ${
              activeTab === tab
                ? "bg-white/10 text-white"
                : "text-slate-500 hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="space-y-3 min-h-[200px]">
        {activeTab === "activity" && (
          <ActivityList
            activity={activity}
            getWalletAddress={getWalletAddress}
            formatAddress={formatAddress}
          />
        )}
        {activeTab === "vault" && <VaultList vault={vault} />}
        {activeTab === "accounts" && (
          <AccountsList
            accounts={accounts}
            streams={streams}
            splits={splits}
            formatAddress={formatAddress}
          />
        )}
      </div>

      <style>{`
        @keyframes fade-in-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
}

function VaultList({ vault }: { vault: VaultToken[] }) {
  if (vault.length === 0) {
    return <p className="text-slate-500 text-sm">No tokens in vault</p>;
  }

  return (
    <div className="space-y-6">
      {vault.map((token, i) => (
        <div
          key={i}
          className="flex items-center justify-between p-5 rounded-xl bg-white/[0.02] border border-white/5"
        >
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs text-slate-400">
              {token.symbol.slice(0, 2)}
            </div>
            <div>
              <p className="text-white text-sm">{token.symbol}</p>
              <p className="text-slate-600 text-xs font-mono">
                {token.token.slice(0, 10)}...
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-white text-sm">
              {token.amount} {token.symbol}
            </p>
            <p className="text-slate-500 text-xs">
              {token.usd} · {token.holders} holder{token.holders !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountsList({
  accounts,
  streams,
  splits,
  formatAddress,
}: {
  accounts: Account[];
  streams: Stream[];
  splits: SplitConfig[];
  formatAddress: (address: string, length?: number) => string;
}) {
  if (accounts.length === 0) {
    return <p className="text-slate-500 text-sm">No accounts found</p>;
  }

  // Build tags for each account based on their activity
  const getAccountTags = (accountId: string): string[] => {
    const tags: string[] = [];

    // Check streams
    const sentStreams = streams.filter((s) => s.from === accountId);
    const receivedStreams = streams.filter((s) => s.to === accountId);
    if (sentStreams.length > 0) tags.push("Streamer");
    if (receivedStreams.length > 0) tags.push("Recipient");

    // Check splits
    const hasSplitConfig = splits.some((s) => s.accountId === accountId);
    const isSplitReceiver = splits.some((s) => s.receivers.some((r) => r.to === accountId));
    if (hasSplitConfig) tags.push("Splitter");
    if (isSplitReceiver) tags.push("Split Receiver");

    return tags;
  };

  const formatDriverName = (driverName?: string | null, driverType?: number) => {
    // Use actual driver name if available, otherwise fallback to type mapping
    if (driverName) {
      // Convert "address_driver" → "Address", "nft_driver" → "NFT"
      return driverName
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
        .replace(" Driver", ""); // Remove redundant "Driver" word
    }
    // Fallback for old data without driver_name
    return driverType === 1 ? "Address" : driverType === 2 ? "NFT" : "Unknown";
  };

  return (
    <div className="space-y-6">
      {accounts.map((account, i) => {
        const walletAddr = account.walletAddress || account.accountId;
        const tags = getAccountTags(account.accountId);

        return (
          <Link
            key={i}
            to="/explorer/u/$address"
            params={{ address: walletAddr }}
            className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all focus:outline-none"
          >
            <div className="flex items-center gap-4">
              <div>
                <p className="text-slate-300 font-mono text-sm">
                  {formatAddress(walletAddr)}
                </p>
                <p className="text-slate-600 text-xs mt-0.5">
                  {formatDriverName(account.driverName, account.driverType)} Driver
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {tags.map((tag, j) => (
                <span
                  key={j}
                  className="px-2 py-1 rounded bg-white/[0.05] text-slate-400 text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ActivityList({
  activity,
  getWalletAddress,
  formatAddress,
}: {
  activity: ActivityEvent[];
  getWalletAddress: (accountId: string) => string;
  formatAddress: (address: string, length?: number) => string;
}) {
  if (activity.length === 0) {
    return <p className="text-slate-500 text-sm">No activity yet</p>;
  }

  return (
    <div className="space-y-6">
      {activity.map((event, i) => (
        <ActivityItem
          key={event.id || i}
          event={event}
          getWalletAddress={getWalletAddress}
          formatAddress={formatAddress}
        />
      ))}
    </div>
  );
}

function ActivityItem({
  event,
  getWalletAddress,
  formatAddress,
}: {
  event: ActivityEvent;
  getWalletAddress: (accountId: string) => string;
  formatAddress: (address: string, length?: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = event.data;
  const from = String(data.account_id || event.accountId);
  const fromWallet = getWalletAddress(from);
  const tokenSymbol = event.tokenSymbol || "TOKEN"; // Fallback to generic

  // StreamsSet - has nested receivers, needs accordion
  if (event.eventType === "StreamsSet") {
    const receivers = (data.receiver_account_ids as string[]) || [];
    const rates = (data.receiver_amt_per_secs as string[]) || [];
    const isStopped = receivers.length === 0;
    const label = isStopped ? "Stop Stream" : "Set Streams";

    return (
      <div className="rounded-xl bg-white/[0.02] border border-white/5">
        <button
          onClick={() => !isStopped && setExpanded(!expanded)}
          className="w-full p-4 focus:outline-none rounded-xl"
        >
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-3">
              <span className="px-2 py-1 rounded bg-white/5 backdrop-blur-sm text-slate-400 text-xs w-fit">
                {label}
              </span>
              <div className="flex items-start gap-3">
                <Link
                  to="/explorer/u/$address"
                  params={{ address: fromWallet }}
                  className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                  onClick={(e) => e.stopPropagation()}
                >
                  {formatAddress(fromWallet, 8)}
                </Link>
                {!isStopped && (
                  <span className="text-slate-500 text-sm">
                    → {receivers.length} recipient{receivers.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-600 text-xs">{timeAgo(event.timestamp)}</span>
              {!isStopped && (
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              )}
            </div>
          </div>
        </button>
        {expanded && receivers.length > 0 && (
          <div className="px-4 pb-4 space-y-2">
            {receivers.map((receiverId, j) => {
              const rate = rates[j] ? ((Number(rates[j]) / 1e17) * 86400).toFixed(4) : "?";
              const receiverWallet = getWalletAddress(receiverId);
              return (
                <div
                  key={j}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02]"
                >
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <Link
                      to="/explorer/u/$address"
                      params={{ address: receiverWallet }}
                      className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                    >
                      {formatAddress(receiverWallet, 10)}
                    </Link>
                  </div>
                  <span className="text-slate-400 text-sm">
                    {rate} {tokenSymbol}/day
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // SplitsSet - has nested receivers, needs accordion
  if (event.eventType === "SplitsSet") {
    const receivers = (data.receiver_account_ids as string[]) || [];
    const weights = (data.receiver_weights as string[]) || [];

    return (
      <div className="rounded-xl bg-white/[0.02] border border-white/5">
        <button
          onClick={() => receivers.length > 0 && setExpanded(!expanded)}
          className="w-full p-4 focus:outline-none rounded-xl"
        >
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-3">
              <span className="px-2 py-1 rounded bg-white/5 backdrop-blur-sm text-slate-400 text-xs w-fit">
                Set Splits
              </span>
              <div className="flex items-start gap-3">
                <Link
                  to="/explorer/u/$address"
                  params={{ address: fromWallet }}
                  className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                  onClick={(e) => e.stopPropagation()}
                >
                  {formatAddress(fromWallet, 8)}
                </Link>
                <span className="text-slate-500 text-sm">
                  → {receivers.length} recipient{receivers.length > 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-600 text-xs">{timeAgo(event.timestamp)}</span>
              {receivers.length > 0 && (
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              )}
            </div>
          </div>
        </button>
        {expanded && receivers.length > 0 && (
          <div className="px-4 pb-4 flex flex-wrap gap-2">
            {receivers.map((receiverId, j) => {
              const pct = weights[j]
                ? Math.round((Number(weights[j]) / 1_000_000) * 100)
                : 0;
              const receiverWallet = getWalletAddress(receiverId);
              return (
                <Link
                  key={j}
                  to="/explorer/u/$address"
                  params={{ address: receiverWallet }}
                  className="px-3 py-1.5 rounded-full bg-white/[0.03] text-slate-400 text-xs hover:text-white focus:outline-none"
                >
                  {pct}% → {formatAddress(receiverWallet, 8)}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Simple transfer events - Give, Receive, Squeeze, Split, Collect
  const methodLabels: Record<string, string> = {
    Given: "Give",
    Received: "Receive",
    Squeezed: "Squeeze",
    SplitExecuted: "Split",
    Collected: "Collect",
  };

  const method = methodLabels[event.eventType] || event.eventType;
  const to = data.receiver_id ? String(data.receiver_id) : null;
  const toWallet = to ? getWalletAddress(to) : null;
  const sender = data.sender_id ? String(data.sender_id) : null;
  const senderWallet = sender ? getWalletAddress(sender) : null;
  const amount = data.amount
    ? (Number(data.amount) / 1e8).toFixed(4) + " " + tokenSymbol
    : null;

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-3">
          <span className="px-2 py-1 rounded bg-white/5 backdrop-blur-sm text-slate-400 text-xs w-fit">
            {method}
          </span>
          <div className="flex items-center gap-3">
            <Link
              to="/explorer/u/$address"
              params={{ address: fromWallet }}
              className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
            >
              {formatAddress(fromWallet, 8)}
            </Link>
            {toWallet && (
              <>
                <ArrowRight className="w-3 h-3 text-slate-600" />
                <Link
                  to="/explorer/u/$address"
                  params={{ address: toWallet }}
                  className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                >
                  {formatAddress(toWallet, 8)}
                </Link>
              </>
            )}
            {senderWallet && event.eventType === "Squeezed" && (
              <span className="text-slate-500 text-sm">
                from {formatAddress(senderWallet, 6)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {amount && <span className="text-white text-sm">{amount}</span>}
          <span className="text-slate-600 text-xs">{timeAgo(event.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}
