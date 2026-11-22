"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { NetworkProvider, useNetwork } from "@/lib/network";
import { VaultProvider } from "@/lib/vault";
import { wagmiConfig } from "@/lib/wagmi";

// Colours come from tokens.css (D25): RainbowKit takes CSS values, so the variables pass through.
const theme = lightTheme({ accentColor: "var(--wallet-accent)", accentColorForeground: "var(--wallet-accent-text)", borderRadius: "large" });

/** Connect the wallet straight to the network picked in the header, not always the first one. */
function RainbowKit({ children }: { children: ReactNode }) {
  const { net } = useNetwork();
  return (
    <RainbowKitProvider initialChain={net.chain} locale="en-US" theme={theme} appInfo={{ appName: "Shaida" }}>
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <VaultProvider>
            <RainbowKit>{children}</RainbowKit>
          </VaultProvider>
        </NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
