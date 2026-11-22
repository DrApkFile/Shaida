import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Providers } from "./providers";
import "./globals.css";

// Inter Tight (SIL OFL 1.1), Muuve's typeface (DESIGN.md); JetBrains Mono (SIL OFL 1.1) for hashes. next/font self-hosts both.
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-inter-tight", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Shaida", template: "%s · Shaida" },
  description: "Private, vouched stablecoin payments on QDay Aevum testnet, built on Gloam.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrains.variable}`}>
      <body>
        <div className="backdrop" aria-hidden="true" />
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
