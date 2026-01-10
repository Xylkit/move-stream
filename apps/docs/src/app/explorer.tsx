import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Search, ArrowRight, Zap, Users, Activity, RefreshCw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { getDeployments, getSyncStatus, triggerSync, searchAddress, timeAgo, type Deployment, type SyncStatus } from "../lib/api";

export const Route = createFileRoute("/explorer")({
  component: ExplorerLayout,
});

function ExplorerLayout() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const matches = useMatches();
  
  const isNested = matches.some(m => 
    m.routeId.includes("/explorer/d") || m.routeId.includes("/explorer/u")
  );

  const handleSearch = async () => {
    if (!searchQuery) return;
    if (searching) return; // Prevent duplicate calls
    
    setSearching(true);
    try {
      const result = await searchAddress(searchQuery);
      
      // If user search with more to discover, auto-continue
      if (result.type === 'user' && result.discoveryProgress?.hasMore) {
        console.log(`[Explorer] Discovery: ${result.discoveryProgress.processed} tx, ${result.deploymentsDiscovered || 0} deployments found`);
        // Auto-trigger next batch after a short delay
        setTimeout(() => {
          setSearching(false); // Reset before next call
          handleSearch();
        }, 500);
        return; // Don't navigate yet, keep searching state
      }
      
      // Discovery complete
      if (result.type === 'deployment') {
        navigate({ to: "/explorer/d/$address", params: { address: result.address } });
      } else {
        navigate({ to: "/explorer/u/$address", params: { address: result.address } });
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-[#030305] text-white overflow-hidden selection:bg-cyan-500/30 font-sans">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[#020204]" />
        <div className="absolute top-[-10%] left-[-10%] w-[120vw] h-[120vw] md:w-[50vw] md:h-[50vw] bg-indigo-500/20 blur-[120px] rounded-full mix-blend-screen animate-aurora" />
        <div className="absolute top-[10%] right-[-10%] w-[140vw] h-[140vw] md:w-[60vw] md:h-[60vw] bg-cyan-600/15 blur-[120px] rounded-full mix-blend-screen animate-aurora delay-[2000ms]" />
        <div className="absolute bottom-[-10%] left-[20%] w-[150vw] h-[150vw] md:w-[70vw] md:h-[50vw] bg-violet-600/15 blur-[140px] rounded-full mix-blend-screen animate-aurora delay-[4000ms]" />
      </div>

      <main className="relative z-10 flex flex-col items-center min-h-screen px-4 pt-32">
        <div className="w-full max-w-2xl mx-auto text-center">
          <div className={`transition-all duration-500 ease-out ${isNested ? "h-0 opacity-0 scale-95 mb-0 overflow-hidden" : "h-auto opacity-100 scale-100 mb-4"}`}>
            <h1 className="text-4xl md:text-5xl font-serif font-light tracking-tight text-white">
              Explore <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-cyan-100 via-white to-indigo-200">Xylkit</span>
            </h1>
          </div>
          
          <div className={`transition-all duration-500 ease-out ${isNested ? "h-0 opacity-0 scale-95 mb-0 overflow-hidden" : "h-auto opacity-100 scale-100 mb-10"}`}>
            <p className="text-lg text-blue-100/50">Search any deployment or wallet address</p>
          </div>

          <div className={`relative transition-all duration-300 ${isNested ? "mb-4" : ""}`}>
            <div className="relative flex items-center">
              <Search className="absolute left-5 w-5 h-5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="0x..."
                className="w-full h-14 pl-14 pr-32 rounded-full bg-white/[0.03] border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:bg-white/[0.05] transition-all text-lg"
              />
              <button
                onClick={handleSearch}
                disabled={searching}
                className="absolute right-2 px-6 py-2.5 rounded-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-sm font-medium hover:from-cyan-500 hover:to-blue-500 transition-all flex items-center gap-2 disabled:opacity-50 focus:outline-none"
              >
                {searching ? "..." : "Search"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {isNested ? <Outlet /> : <DeploymentsGrid />}
      </main>

      <style>{`
        @keyframes fade-in-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0; }
        .delay-100 { animation-delay: 100ms; }
        .delay-200 { animation-delay: 200ms; }
        @keyframes aurora { 0% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -50px) scale(1.1); } 66% { transform: translate(-20px, 20px) scale(0.9); } 100% { transform: translate(0, 0) scale(1); } }
        .animate-aurora { animation: aurora 20s ease-in-out infinite; }
      `}</style>
    </div>
  );
}


function DeploymentsGrid() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadData = async () => {
    try {
      const [deps, status] = await Promise.all([getDeployments(), getSyncStatus()]);
      setDeployments(deps);
      setSyncStatus(status.status);
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerSync({ force: true });
      await loadData();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadData();
    // Poll sync status every 10s
    const interval = setInterval(async () => {
      const status = await getSyncStatus();
      setSyncStatus(status.status);
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const getLastSynced = (address: string) => {
    const s = syncStatus.find(s => s.deployment === address);
    return s?.lastSyncedAt ? timeAgo(s.lastSyncedAt) : 'never';
  };

  if (loading) {
    return <div className="mt-20 text-slate-500">Loading...</div>;
  }

  return (
    <div className="w-full max-w-5xl mx-auto mt-20 pb-20">
      <div className="flex items-center justify-between mb-6">
        <h2 className="animate-fade-in-up delay-100 text-sm font-medium text-slate-500 uppercase tracking-wider">
          Known Deployments
        </h2>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors disabled:opacity-50 focus:outline-none"
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      
      <div className="animate-fade-in-up delay-200 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {deployments.map((deployment, i) => (
          <Link
            key={i}
            to="/explorer/d/$address"
            params={{ address: deployment.address }}
            className="group text-left p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-cyan-500/30 hover:bg-white/[0.04] transition-all"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-white font-mono text-sm">{deployment.address.slice(0, 8)}...{deployment.address.slice(-4)}</p>
                <p className="text-slate-500 text-xs mt-1">Movement Testnet</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-cyan-400" />
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                {deployment.streams} streams
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {deployment.accounts}
              </span>
            </div>
            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
              <div>
                <p className="text-cyan-400 text-sm font-medium">{deployment.volumeUsd}</p>
                <p className="text-slate-600 text-xs">Volume</p>
              </div>
              <p className="text-slate-600 text-xs">indexed {getLastSynced(deployment.address)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
