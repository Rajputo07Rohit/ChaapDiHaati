import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import "./index.css";
import { applyTheme, getStoredTheme } from "./utils/theme";

// Apply any saved theme choice before first paint, so the page doesn't
// flash the default light theme and then swap.
applyTheme(getStoredTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    // Cross-device flows (rider updates an order on their phone; admin has
    // it open on the counter screen) rely on refetching to see it — window
    // focus is the cheap, natural trigger for "I just tabbed back, is this
    // still current" without needing a dedicated polling interval everywhere.
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
