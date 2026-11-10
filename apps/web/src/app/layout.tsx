import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./home.css";

export const metadata: Metadata = {
  title: "SyncUp | Your work, connected",
  description: "A modular business workspace platform"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
