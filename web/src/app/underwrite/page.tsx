import type { Metadata } from "next";
import { BotDesk } from "./BotDesk";

export const metadata: Metadata = {
  title: "Underwriting bot · Shaida",
  description: "A deterministic bot that checks a Shaida income proof link against a published policy: APPROVE, DECLINE with reasons, or INCONCLUSIVE.",
};

export default function UnderwritePage() {
  return <BotDesk />;
}
