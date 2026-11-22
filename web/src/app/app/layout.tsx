import type { ReactNode } from "react";
import { SectionTabs } from "./SectionTabs";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs />
      {children}
    </>
  );
}
