"use client";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { poolIndexOf, type CheckedTrees } from "@shaida/index";
import type { Note } from "@shaida/pay";
import type { Result } from "@shaida/proofs";
import type { Wiring } from "@/lib/flows";
import { useVault } from "@/lib/vault";

export interface Funds {
  /** Spendable now: in the checked pool tree and unspent at the snapshot's block. */
  readonly spendable: readonly Note[];
  readonly total: string | null;
  readonly summary: string;
}

/** Derived from the chain, not from flags: a note counts only if the pool has it and its nullifier is unspent. */
export function useFunds(w: Wiring | null, trees: Result<CheckedTrees> | undefined): Funds {
  const vault = useVault();
  const notes = vault.data?.payerNotes ?? [];
  const t = trees?.ok ? trees.value : null;
  const q = useQuery({
    queryKey: ["funds", w?.net.chain.id, t?.block.toString(), notes.map((n) => n.note.commitment).join()],
    enabled: Boolean(w && t),
    queryFn: async () => {
      if (!w || !t) return { spendable: [], waiting: 0 };
      const spendable: Note[] = [];
      let waiting = 0;
      for (const { note } of notes) {
        if (BigInt(note.amountWei) === 0n) continue;
        if (poolIndexOf(t, note.commitment) < 0) { waiting++; continue; }
        if (!(await w.isSpent(note.nullifier, t.block))) spendable.push(note);
      }
      return { spendable, waiting };
    },
  });
  if (!t || !q.data) return { spendable: [], total: null, summary: trees && !trees.ok ? "Can't show a balance until the trees check out." : "Syncing the pool…" };
  const sum = q.data.spendable.reduce((a, n) => a + BigInt(n.amountWei), 0n);
  const waiting = q.data.waiting ? ` ${q.data.waiting} note(s) not in the pool (a deposit that hasn't landed, or never did).` : "";
  return { spendable: q.data.spendable, total: formatUnits(sum, 6), summary: `${q.data.spendable.length} spendable note(s) at block ${t.block}.${waiting}` };
}
