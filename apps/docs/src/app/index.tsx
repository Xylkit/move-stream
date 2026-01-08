import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="relative min-h-screen w-full bg-[#030305] text-white overflow-hidden selection:bg-cyan-500/30 font-sans overscroll-none">
      {/* Background Effects - Liquid Aurora */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Deep Void Base */}
        <div className="absolute inset-0 bg-[#020204]" />

        {/* Liquid Mesh Gradients - The "Aurora" - Increased size for mobile visibility */}
        <div className="absolute top-[-10%] left-[-10%] w-[120vw] h-[120vw] md:w-[50vw] md:h-[50vw] bg-indigo-500/20 blur-[120px] rounded-full mix-blend-screen animate-aurora" />
        <div className="absolute top-[10%] right-[-10%] w-[140vw] h-[140vw] md:w-[60vw] md:h-[60vw] bg-cyan-600/15 blur-[120px] rounded-full mix-blend-screen animate-aurora delay-[2000ms]" />
        <div className="absolute bottom-[-10%] left-[20%] w-[150vw] h-[150vw] md:w-[70vw] md:h-[50vw] bg-violet-600/15 blur-[140px] rounded-full mix-blend-screen animate-aurora delay-[4000ms]" />

        {/* Subtle Noise Texture - The "Film Grain" Premium Feel */}
        <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay bg-noise pointer-events-none" />

        {/* Very Faint Grid (Structure) - 2% Opacity */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:100px_100px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] contrast-125 saturate-0" />
      </div>

      {/* Floating Navbar */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-4xl px-4">
        <div className="relative flex items-center justify-between p-2 rounded-full border border-white/5 bg-black/40 backdrop-blur-xl shadow-[0_4px_30px_-5px_rgba(0,0,0,0.5)]">
          {/* Logo / Links */}
          <div className="flex items-center gap-1 md:gap-2 px-4">
            <Link
              to="/"
              className="text-white font-serif font-semibold tracking-wide text-xl mr-6 italic"
            >
              Xylkit
            </Link>
            <div className="hidden md:flex items-center gap-8 text-sm text-slate-400 font-medium">
              <Link
                to="/documentation"
                className="hover:text-cyan-200 transition-colors tracking-wide"
              >
                Docs
              </Link>
              <Link
                to="/explorer"
                className="hover:text-cyan-200 transition-colors tracking-wide"
              >
                Explorer
              </Link>
            </div>
          </div>

          {/* CTA */}
          <button className="group relative flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-cyan-50 transition-all shadow-[0_0_20px_-5px_rgba(255,255,255,0.4)]">
            <span className="tracking-wide">Launch Demo</span>
            <ChevronRight className="w-4 h-4 text-black/70 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 text-center pt-20">
        {/* Status Badge */}
        {/* Status Badge Removed per user request */}

        {/* Main Title */}
        <h1 className="animate-fade-in-up delay-200 max-w-6xl mx-auto font-serif text-7xl md:text-8xl lg:text-9xl font-light tracking-tight text-white mb-12 leading-[0.9]">
          Own Your Financial
          <br />
          <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-cyan-100 via-white to-indigo-200 drop-shadow-[0_0_35px_rgba(6,182,212,0.4)] pr-4">
            Streams
          </span>
        </h1>

        {/* Subtitle */}
        <p className="animate-fade-in-up delay-300 max-w-2xl mx-auto text-xl md:text-2xl text-blue-100/60 font-light leading-relaxed text-balance mb-14 tracking-wide">
          The first streaming protocol on{" "}
          <span className="text-cyan-100 font-medium">Movement</span>. Deploy your own
          stream contracts. Hook into everything using your own infrastructure.
        </p>

        {/* Action Buttons */}
        <div className="animate-fade-in-up delay-500 flex flex-col sm:flex-row items-center gap-5 sm:gap-8">
          <Link
            to="/explorer"
            className="group relative px-9 py-4 rounded-full bg-gradient-to-r from-[#0B1221] to-[#0f172a] border border-cyan-500/30 text-white font-medium hover:border-cyan-400/60 transition-all shadow-[0_0_25px_-8px_rgba(6,182,212,0.4)] hover:shadow-[0_0_35px_-5px_rgba(6,182,212,0.6)] overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2 tracking-wide">
              Explore Streams
              <Zap className="w-4 h-4 text-cyan-300 fill-cyan-300" />
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-600/10 to-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          </Link>

          <Link
            to="/documentation"
            className="group flex items-center gap-2 px-9 py-4 rounded-full border border-white/5 bg-white/[0.02] text-slate-300 hover:text-white hover:border-white/20 hover:bg-white/[0.05] transition-all backdrop-blur-sm"
          >
            <span className="tracking-wide">Read Documentation</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform opacity-70 group-hover:opacity-100" />
          </Link>
        </div>

        {/* Floating Labels */}
        <div className="hidden lg:block absolute top-[35%] right-[12%] animate-pulse duration-[3000ms]">
          <div className="text-[10px] font-mono text-cyan-400/40 tracking-[0.3em] uppercase border-t border-cyan-500/10 pt-3 w-32 text-right">
            Zero Latency
          </div>
        </div>
        <div className="hidden lg:block absolute bottom-[20%] left-[12%]">
          <div className="text-[10px] font-mono text-indigo-400/40 tracking-[0.3em] uppercase border-b border-indigo-500/10 pb-3 w-32 text-left">
            Defi Native
          </div>
        </div>
      </main>

      <style>{`
        :root {
          --font-sans: 'Outfit', sans-serif;
          --font-serif: 'Cormorant Garamond', serif;
        }
        .font-sans { font-family: var(--font-sans); }
        .font-serif { font-family: var(--font-serif); }
        
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(30px); filter: blur(10px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes fade-in-down {
          from { opacity: 0; transform: translateY(-20px); filter: blur(5px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0; 
        }
        .animate-fade-in-down {
          animation: fade-in-down 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
        .delay-100 { animation-delay: 100ms; }
        .delay-200 { animation-delay: 200ms; }
        .delay-300 { animation-delay: 400ms; }
        .delay-500 { animation-delay: 600ms; }

        @keyframes aurora {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0, 0) scale(1); }
        }
        .animate-aurora {
          animation: aurora 20s ease-in-out infinite;
        }

        .bg-noise {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='1'/%3E%3C/svg%3E");
        }
      `}</style>
    </div>
  );
}
