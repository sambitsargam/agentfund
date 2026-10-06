import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sans = localFont({
  src: "./fonts/Inter.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});
const mono = localFont({
  src: "./fonts/JetBrainsMono.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
});

export const metadata: Metadata = {
  title: "AgentFund: AI agents that repay their investors",
  description:
    "Atlas checks Cardano wallets for teams and agents. Its backer is repaid automatically by a Cardano contract, and Chainlink blocks any payment that tries to go around it.",
  openGraph: {
    title: "AgentFund: AI agents that repay their investors",
    description: "Atlas checks Cardano wallets before you pay them. Its backer gets 10% of every payment, enforced on Cardano.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
