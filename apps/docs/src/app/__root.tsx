import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import RootProvider from "@/providers";
import { Toaster } from "@/components/atoms/sonner";
import { ThemeSwitcher } from "@/components/molecules/theme-switcher";
import { ChevronRight } from "lucide-react";
import "@/styles/globals.css";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <RootProvider>
      <div className="min-h-screen flex flex-col">
        {/* Floating Navbar - Used on all pages */}
        <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-4xl px-4">
          <div className="relative flex items-center justify-between p-2 rounded-full border border-white/5 bg-black/60 dark:bg-black/40 backdrop-blur-xl shadow-[0_4px_30px_-5px_rgba(0,0,0,0.5)]">
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
                  activeProps={{ className: "text-cyan-300" }}
                >
                  Docs
                </Link>
                <Link
                  to="/explorer"
                  className="hover:text-cyan-200 transition-colors tracking-wide"
                  activeProps={{ className: "text-cyan-300" }}
                >
                  Explorer
                </Link>
              </div>
            </div>

            {/* CTA & Theme */}
            <div className="flex items-center gap-2">
              <ThemeSwitcher />
              <Link
                to="/demo"
                className="group relative flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-cyan-50 transition-all shadow-[0_0_20px_-5px_rgba(255,255,255,0.4)]"
              >
                <span className="tracking-wide">Launch Demo</span>
                <ChevronRight className="w-4 h-4 text-black/70 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </div>
        </nav>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
      <Toaster />
      <TanStackRouterDevtools />
    </RootProvider>
  );
}
