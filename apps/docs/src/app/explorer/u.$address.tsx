import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getUser, triggerSync, getSyncStatus, timeAgo, type UserDeployment } from "../../lib/api";

export const Route = createFileRoute("/explorer/u/$address")({
  component: UserView,
});

function UserView() {
  const { address } = Route.useParams();
  const [deployments, setDeployments] = useState<UserDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchData = async () => {
    try {
      const userData = await getUser(address);
      setDeployments(userData.deployments);
    } catch (err) {
      console.error('Failed to fetch user:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSyncStatus = async () => {
    try {
      const status = await getSyncStatus();
      if (status.status.length > 0) {
        setLastSynced(status.status[0].lastSyncedAt);
      }
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await triggerSync({ user: address });
      setLastSynced(result.lastSyncedAt);
      await fetchData();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    // Trigger sync with user priority on mount
    triggerSync({ user: address }).then((result) => {
      setLastSynced(result.lastSyncedAt);
    }).catch(() => {});
    
    fetchData();
    fetchSyncStatus();

    // Poll sync status every 30s for freshness indicator
    const interval = setInterval(() => {
      fetchSyncStatus();
    }, 30_000);
    return () => clearInterval(interval);
  }, [address]);

  if (loading) {
    return (
      <div className="w-full max-w-5xl mx-auto mt-12 animate-fade-in-up">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto mt-12 pb-20 animate-fade-in-up">
      <Link 
        to="/explorer"
        className="text-slate-500 hover:text-white text-sm mb-6 flex items-center gap-2 transition-colors"
      >
        ← Back to search
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-serif text-white mb-2">User</h2>
          <p className="text-slate-500 font-mono text-sm">{address}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-slate-600 text-xs">
            {lastSynced ? `indexed ${timeAgo(lastSynced)}` : 'not indexed'}
            <button 
              onClick={handleSync}
              disabled={syncing}
              className="ml-2 text-cyan-500 hover:text-cyan-400 disabled:opacity-50 focus:outline-none"
            >
              {syncing ? '↻' : '↻'}
            </button>
          </div>
          <button className="px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/10 text-slate-400 text-sm hover:border-cyan-500/30 hover:text-white transition-all focus:outline-none">
            Connect to claim
          </button>
        </div>
      </div>

      {deployments.length === 0 ? (
        <div className="text-slate-500 text-center py-12">
          No activity found for this address
        </div>
      ) : (
        <div className="space-y-6">
          {deployments.map((dep, i) => (
            <div
              key={i}
              className="p-6 rounded-2xl bg-white/[0.02] border border-white/5"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <Link 
                    to="/explorer/d/$address"
                    params={{ address: dep.address }}
                    className="text-white font-mono text-sm hover:text-cyan-400 transition-colors"
                  >
                    {dep.address.slice(0, 6)}...{dep.address.slice(-4)}
                  </Link>
                  <p className="text-slate-600 text-xs mt-0.5">{dep.network}</p>
                </div>
              </div>

              {/* Balances */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="p-4 rounded-xl bg-white/[0.02]">
                  <p className="text-xl font-light text-white">{dep.splittable}</p>
                  <p className="text-slate-500 text-xs">Splittable</p>
                  {Number(dep.splittable) > 0 && (
                    <button className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 focus:outline-none">Split →</button>
                  )}
                </div>
                <div className="p-4 rounded-xl bg-white/[0.02]">
                  <p className="text-xl font-light text-cyan-400">{dep.collectable}</p>
                  <p className="text-slate-500 text-xs">Collectable</p>
                  {Number(dep.collectable) > 0 && (
                    <button className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 focus:outline-none">Collect →</button>
                  )}
                </div>
                <div className="p-4 rounded-xl bg-white/[0.02]">
                  <p className="text-xl font-light text-white">{dep.streaming}</p>
                  <p className="text-slate-500 text-xs">Streaming</p>
                </div>
              </div>

              {/* Incoming Streams */}
              {dep.incoming.length > 0 && (
                <div className="mb-4">
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Incoming Streams</p>
                  <div className="space-y-2">
                    {dep.incoming.map((stream, j) => (
                      <div key={j} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02]">
                        <span className="text-slate-400 text-sm font-mono">
                          From {stream.from.slice(0, 8)}...
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-cyan-400 text-sm">{stream.rate} APT{stream.rateUnit}</span>
                          <button className="text-xs text-slate-500 hover:text-white px-2 py-1 rounded bg-white/[0.03] focus:outline-none">Receive</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outgoing Streams */}
              {dep.outgoing.length > 0 && (
                <div className="mb-4">
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Outgoing Streams</p>
                  <div className="space-y-2">
                    {dep.outgoing.map((stream, j) => (
                      <div key={j} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02]">
                        <span className="text-slate-400 text-sm font-mono">
                          To {stream.to.slice(0, 8)}...
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-white text-sm">{stream.rate} APT{stream.rateUnit}</span>
                          <span className="text-slate-500 text-xs">{stream.durationText}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Splits Config */}
              {dep.splits.length > 0 && (
                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Splits Config</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {dep.splits.map((split, j) => (
                      <span key={j} className="px-3 py-1.5 rounded-full bg-white/[0.03] text-slate-400 text-xs">
                        {split.pct}% → {split.to.slice(0, 8)}...
                      </span>
                    ))}
                    <span className="px-3 py-1.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs">
                      {100 - dep.splits.reduce((a, b) => a + b.pct, 0)}% kept
                    </span>
                  </div>
                </div>
              )}

              {/* Empty state for no activity */}
              {dep.incoming.length === 0 && dep.outgoing.length === 0 && dep.splits.length === 0 && (
                <p className="text-slate-600 text-sm">No streams or splits configured</p>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
