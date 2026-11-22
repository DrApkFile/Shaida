"use client";
// The dashboard's sections (D26): one row of pills under the header, scrollable at 390 px.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { InboxIcon, LinkIcon, ProofIcon, SendIcon } from "@/components/Icons";

const SECTIONS = [
  { href: "/app", label: "Overview", icon: null },
  { href: "/app/pay", label: "Pay", icon: <SendIcon size={16} /> },
  { href: "/app/inbox", label: "Inbox", icon: <InboxIcon size={16} /> },
  { href: "/app/prove", label: "Prove", icon: <ProofIcon size={16} /> },
  { href: "/app/shared", label: "Shared proofs", icon: <LinkIcon size={16} /> },
  { href: "/app/withdraw", label: "Withdraw", icon: null },
] as const;

export function SectionTabs() {
  const path = usePathname();
  return (
    <nav className="shell section-tabs" aria-label="Dashboard sections">
      {SECTIONS.map((s) => {
        const active = s.href === "/app" ? path === "/app" : path.startsWith(s.href);
        return (
          <Link key={s.href} href={s.href} aria-current={active ? "page" : undefined}>
            {s.icon}
            <span>{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
