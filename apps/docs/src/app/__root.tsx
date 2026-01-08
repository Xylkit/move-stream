import { createRootRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import RootProvider from "@/providers";
import { Toaster } from "@/components/atoms/sonner";
import { WalletConnectButton } from "@/components/molecules/wallet-connect-button";
import { ThemeSwitcher } from "@/components/molecules/theme-switcher";
import "@/styles/globals.css";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  return (
    <RootProvider>
      <div className="min-h-screen flex flex-col">
        {!isHomePage && (
          <header className="border-b">
            <nav className="container mx-auto px-4 py-4 flex items-center justify-between">
              <Link to="/" className="text-xl font-bold">
                Xylkit
              </Link>
              <div className="flex items-center gap-6">
                <Link
                  to="/documentation"
                  className="text-sm font-medium hover:text-primary transition-colors"
                >
                  Documentation
                </Link>
                <Link
                  to="/demo"
                  className="text-sm font-medium hover:text-primary transition-colors"
                >
                  demo
                </Link>
                <div className="flex items-center gap-4">
                  <ThemeSwitcher />
                  <WalletConnectButton />
                </div>
              </div>
            </nav>
          </header>
        )}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
      <Toaster />
      <TanStackRouterDevtools />
    </RootProvider>
  );
}
