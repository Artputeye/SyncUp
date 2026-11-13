"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type NavigationItem = { id: string; label: string; href: string; icon: string };
type NavigationResponse = { workspace: { id: string; slug: string; type: "POS" | "ONLINE" }; items: NavigationItem[] };

export function WorkspaceNavigation({
  workspaceId,
  className = "user-menu",
  linkClassName = "ghost",
}: {
  workspaceId: string;
  className?: string;
  linkClassName?: string;
}) {
  const [items, setItems] = useState<NavigationItem[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/navigation`, {
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error("ไม่สามารถโหลดเมนู Workspace ได้");
      return response.json() as Promise<NavigationResponse>;
    }).then((data) => {
      if (active) setItems(data.items);
    }).catch(() => {
      if (active) setItems([]);
    });
    return () => { active = false; };
  }, [workspaceId]);

  if (!items.length) return null;
  return (
    <nav className={className} aria-label="เมนู Workspace">
      {items.map((item) => (
        <Link key={item.id} className={linkClassName} href={item.href}>{item.label}</Link>
      ))}
    </nav>
  );
}
