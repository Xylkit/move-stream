import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "@/styles/globals.css";

const browserHistory = createBrowserHistory();

const router = createRouter({
  routeTree,
  context: {},
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
  history: browserHistory,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
