"use client";
import { useMemo, useState } from "react";
import { ProblemBox } from "@/components/ProblemBox";
import { VaultBar, VaultGate } from "@/components/VaultGate";
import { wiringFor } from "@/lib/flows";
import { useNetwork } from "@/lib/network";
import { usePayer } from "@/lib/payer";
import { useTrees } from "@/lib/useTrees";
import { DepositCard } from "./DepositCard";
import { useFunds } from "./funds";
import { PayCard } from "./PayCard";
import { PayerPanel } from "./PayerPanel";

export default function PayPage() {
  return (
    <main className="shell stack page">
      <header className="page-head">
        <p className="eyebrow">Payer</p>
        <h1>Pay privately</h1>
        <p className="lede">
          Deposit tUSD8 into the private pool with a signature only (the relayer pays gas), then pay a recipient&apos;s receive address.
          The chain shows that a registered payer paid someone; not who, and not how much.
        </p>
      </header>
      <VaultGate purpose="Your private notes (the money you deposited) are secrets.">
        <VaultBar />
        <PayDesk />
      </VaultGate>
    </main>
  );
}

function PayDesk() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  const [prefer, setPrefer] = useState<"wallet" | "demo">("wallet");
  const payer = usePayer(prefer);
  const trees = useTrees(w.ok ? w.value : null);
  const funds = useFunds(w.ok ? w.value : null, trees.data);

  if (!w.ok) return <div className="notice bad" role="alert"><strong>NotConfigured</strong> {w.problem}</div>;
  const treeProblem = trees.data && !trees.data.ok ? trees.data.error : null;
  return (
    <div className="stack">
      <PayerPanel w={w.value} prefer={prefer} setPrefer={setPrefer} payer={payer} />
      <section className="card stack" aria-labelledby="funds">
        <div className="row-between">
          <h2 id="funds">Private balance</h2>
          <button className="btn ghost small" type="button" onClick={() => void trees.refetch()} disabled={trees.isFetching}>{trees.isFetching ? "Syncing…" : "Resync"}</button>
        </div>
        <p className="total num">{funds.total === null ? "—" : `${funds.total} tUSD8`}</p>
        <p className="sub">{funds.summary}</p>
        <ProblemBox problem={treeProblem} />
      </section>
      <DepositCard w={w.value} payer={payer} onDone={() => void trees.refetch()} />
      <PayCard w={w.value} payer={payer} funds={funds} onDone={() => void trees.refetch()} />
    </div>
  );
}
