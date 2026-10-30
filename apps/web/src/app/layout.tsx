import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = { title: "SyncUp", description: "A modular business workspace platform" };
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
