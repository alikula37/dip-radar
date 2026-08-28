import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dip Radar",
  description: "Visualize BTC-parity altcoin dips",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
