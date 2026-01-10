import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ArrowRight, RefreshCw, ChevronDown } from "lucide-react";
import { 
  getDeployment, getDeploymentStreams, getDeploymentSplits, getDeploymentAccounts, getDeploymentActivity, getDeploymentVault,
  getSyncStatus, triggerSync, timeAgo, formatAccountId, getAccountAddress,
  type Deployment, type Stream, type SplitConfig, type Account, type ActivityEvent, type VaultToken 
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
      console.error('Failed to load:', err);
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
        console.log(`[Deployment] Sync progress: ${result.eventsProcessed} events, cursor at ${result.cursor}, continuing...`);
        await loadData(); // Refresh UI with new data
        setTimeout(() => handleSync(), 500); // Continue after 500ms
        return true; // Still syncing
      }
      
      console.log(`[Deployment] Sync complete: ${result.eventsProcessed} events`);
      await loadData();
      setSyncing(false);
      return false; // Done
    } catch (err) {
      console.error('[Deployment] Sync failed:', err);
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

  const activeStreams = streams.filter(s => s.active);

  return (
    <div className="w-full max-w-5xl mx-auto mt-12 pb-20 animate-fade-in-up">
      <Link to="/explorer" className="text-slate-500 hover:text-white text-sm mb-6 flex items-center gap-2 transition-colors focus:outline-none rounded">
        ← Back to search
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-serif text-white mb-2">Deployment</h2>
          <p className="text-slate-500 font-mono text-sm">{address}</p>
          <p className="text-cyan-400 text-xs mt-1">Movement Testnet</p>
        </div>
        <div className="text-right">
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors disabled:opacity-50 focus:outline-none">
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <p className="text-slate-600 text-xs mt-1">indexed {timeAgo(lastSynced)}</p>
        </div>
      </div>

      {/* Stats Bar - 4 columns on desktop, 2x2 on mobile */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-xl font-light text-cyan-400">{deployment?.stats?.tvlUsd || '$0'}</p>
          <p className="text-slate-500 text-xs mt-1">TVL</p>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-xl font-light text-white">{deployment?.stats?.totalVolumeUsd || '$0'}</p>
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
              activeTab === tab ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="space-y-3 min-h-[200px]">
        {activeTab === "activity" && <ActivityList activity={activity} />}
        {activeTab === "vault" && <VaultList vault={vault} />}
        {activeTab === "accounts" && <AccountsList accounts={accounts} streams={streams} splits={splits} />}
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
        <div key={i} className="flex items-center justify-between p-5 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs text-slate-400">
              {token.symbol.slice(0, 2)}
            </div>
            <div>
              <p className="text-white text-sm">{token.symbol}</p>
              <p className="text-slate-600 text-xs font-mono">{token.token.slice(0, 10)}...</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-white text-sm">{token.amount} {token.symbol}</p>
            <p className="text-slate-500 text-xs">{token.usd} · {token.holders} holder{token.holders !== 1 ? 's' : ''}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StreamsList({ streams }: { streams: Stream[] }) {
  if (streams.length === 0) {
    return <p className="text-slate-500 text-sm">No streams found</p>;
  }

  return (
    <>
      {streams.map((stream, i) => (
        <div key={i} className={`p-5 rounded-xl border transition-all ${
          stream.active 
            ? "bg-white/[0.02] border-white/5 hover:border-white/10" 
            : "bg-white/[0.01] border-white/5 opacity-60"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link 
                to="/explorer/u/$address" 
                params={{ address: getAccountAddress(stream.from) }}
                className="text-white font-mono text-sm hover:text-cyan-400 transition-colors focus:outline-none rounded"
              >
                {formatAccountId(stream.from)}
              </Link>
              <ArrowRight className={`w-4 h-4 ${stream.active ? 'text-cyan-500' : 'text-slate-600'}`} />
              <Link 
                to="/explorer/u/$address" 
                params={{ address: getAccountAddress(stream.to) }}
                className="text-white font-mono text-sm hover:text-cyan-400 transition-colors focus:outline-none rounded"
              >
                {formatAccountId(stream.to)}
              </Link>
            </div>
            <div className="text-right">
              <p className={`text-sm font-medium ${stream.active ? 'text-cyan-400' : 'text-slate-500'}`}>
                {stream.rate} APT{stream.rateUnit}
              </p>
              <p className={`text-xs ${stream.active ? 'text-slate-500' : 'text-red-400/70'}`}>
                {stream.durationText}
              </p>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function SplitsList({ splits }: { splits: SplitConfig[] }) {
  if (splits.length === 0) {
    return <p className="text-slate-500 text-sm">No split configurations found</p>;
  }

  return (
    <>
      {splits.map((config, i) => (
        <div key={i} className="p-5 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <Link 
              to="/explorer/u/$address" 
              params={{ address: getAccountAddress(config.accountId) }}
              className="text-white font-mono text-sm hover:text-cyan-400 transition-colors focus:outline-none rounded"
            >
              {formatAccountId(config.accountId)}
            </Link>
            <span className="text-slate-500 text-xs">{config.totalPct}% distributed</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {config.receivers.map((r, j) => (
              <Link
                key={j}
                to="/explorer/u/$address"
                params={{ address: getAccountAddress(r.to) }}
                className="px-3 py-1.5 rounded-full bg-white/[0.03] text-slate-400 text-xs hover:bg-white/[0.06] hover:text-white transition-all focus:outline-none"
              >
                {r.pct}% → {formatAccountId(r.to, 8)}
              </Link>
            ))}
            {config.totalPct < 100 && (
              <span className="px-3 py-1.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs">
                {100 - config.totalPct}% kept
              </span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function AccountsList({ accounts, streams, splits }: { accounts: Account[]; streams: Stream[]; splits: SplitConfig[] }) {
  if (accounts.length === 0) {
    return <p className="text-slate-500 text-sm">No accounts found</p>;
  }

  // Build tags for each account based on their activity
  const getAccountTags = (accountId: string): string[] => {
    const tags: string[] = [];
    
    // Check streams
    const sentStreams = streams.filter(s => s.from === accountId);
    const receivedStreams = streams.filter(s => s.to === accountId);
    if (sentStreams.length > 0) tags.push('Streamer');
    if (receivedStreams.length > 0) tags.push('Recipient');
    
    // Check splits
    const hasSplitConfig = splits.some(s => s.accountId === accountId);
    const isSplitReceiver = splits.some(s => s.receivers.some(r => r.to === accountId));
    if (hasSplitConfig) tags.push('Splitter');
    if (isSplitReceiver) tags.push('Split Receiver');
    
    return tags;
  };

  const driverName = (type: number) => type === 1 ? 'Address' : type === 2 ? 'NFT' : 'Unknown';

  return (
    <div className="space-y-6">
      {accounts.map((account, i) => {
        const walletAddr = account.walletAddress || getAccountAddress(account.accountId);
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
                  {walletAddr.slice(0, 10)}...{walletAddr.slice(-4)}
                </p>
                <p className="text-slate-600 text-xs mt-0.5">{driverName(account.driverType)} Driver</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {tags.map((tag, j) => (
                <span key={j} className="px-2 py-1 rounded bg-white/[0.05] text-slate-400 text-xs">
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

function ActivityList({ activity }: { activity: ActivityEvent[] }) {
  if (activity.length === 0) {
    return <p className="text-slate-500 text-sm">No activity yet</p>;
  }

  return (
    <div className="space-y-6">
      {activity.map((event, i) => (
        <ActivityItem key={event.id || i} event={event} />
      ))}
    </div>
  );
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const data = event.data;
  const from = String(data.account_id || event.accountId);
  
  // StreamsSet - has nested receivers, needs accordion
  if (event.eventType === 'StreamsSet') {
    const receivers = (data.receiver_account_ids as string[]) || [];
    const rates = (data.receiver_amt_per_secs as string[]) || [];
    const isStopped = receivers.length === 0;
    const label = isStopped ? 'Stop Stream' : 'Set Streams';
    
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
                  params={{ address: getAccountAddress(from) }}
                  className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                  onClick={e => e.stopPropagation()}
                >
                  {formatAccountId(from, 8)}
                </Link>
                {!isStopped && (
                  <span className="text-slate-500 text-sm">→ {receivers.length} recipient{receivers.length > 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-600 text-xs">{timeAgo(event.timestamp)}</span>
              {!isStopped && (
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              )}
            </div>
          </div>
        </button>
        {expanded && receivers.length > 0 && (
          <div className="px-4 pb-4 space-y-2">
            {receivers.map((receiverId, j) => {
              const rate = rates[j] ? (Number(rates[j]) / 1e17 * 86400).toFixed(4) : '?';
              return (
                <div key={j} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <Link 
                      to="/explorer/u/$address" 
                      params={{ address: getAccountAddress(receiverId) }}
                      className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                    >
                      {formatAccountId(receiverId, 10)}
                    </Link>
                  </div>
                  <span className="text-slate-400 text-sm">{rate} APT/day</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // SplitsSet - has nested receivers, needs accordion
  if (event.eventType === 'SplitsSet') {
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
                  params={{ address: getAccountAddress(from) }}
                  className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                  onClick={e => e.stopPropagation()}
                >
                  {formatAccountId(from, 8)}
                </Link>
                <span className="text-slate-500 text-sm">→ {receivers.length} recipient{receivers.length > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-600 text-xs">{timeAgo(event.timestamp)}</span>
              {receivers.length > 0 && (
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              )}
            </div>
          </div>
        </button>
        {expanded && receivers.length > 0 && (
          <div className="px-4 pb-4 flex flex-wrap gap-2">
            {receivers.map((receiverId, j) => {
              const pct = weights[j] ? Math.round((Number(weights[j]) / 1_000_000) * 100) : 0;
              return (
                <Link
                  key={j}
                  to="/explorer/u/$address"
                  params={{ address: getAccountAddress(receiverId) }}
                  className="px-3 py-1.5 rounded-full bg-white/[0.03] text-slate-400 text-xs hover:text-white focus:outline-none"
                >
                  {pct}% → {formatAccountId(receiverId, 8)}
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
    'Given': 'Give',
    'Received': 'Receive',
    'Squeezed': 'Squeeze',
    'SplitExecuted': 'Split',
    'Collected': 'Collect',
  };
  
  const method = methodLabels[event.eventType] || event.eventType;
  const to = data.receiver_id ? String(data.receiver_id) : null;
  const sender = data.sender_id ? String(data.sender_id) : null;
  const amount = data.amount ? (Number(data.amount) / 1e8).toFixed(4) + ' APT' : null;

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
              params={{ address: getAccountAddress(from) }}
              className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
            >
              {formatAccountId(from, 8)}
            </Link>
            {to && (
              <>
                <ArrowRight className="w-3 h-3 text-slate-600" />
                <Link 
                  to="/explorer/u/$address" 
                  params={{ address: getAccountAddress(to) }}
                  className="text-slate-300 font-mono text-sm hover:text-white focus:outline-none rounded"
                >
                  {formatAccountId(to, 8)}
                </Link>
              </>
            )}
            {sender && event.eventType === 'Squeezed' && (
              <span className="text-slate-500 text-sm">from {formatAccountId(sender, 6)}</span>
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
