"use client";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, parseAbi } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { TUSD8_ADDRESS } from "@shaida/proofs";
import type { Wiring } from "@/lib/flows";
import { DEMO_CHAIN_ID, DEMO_PAYER_NAME, type PayerSigner } from "@/lib/payer";
import { useVault } from "@/lib/vault";

const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export function PayerPanel({ w, prefer, setPrefer, payer }: { w: Wiring; prefer: "wallet" | "demo"; setPrefer(p: "wallet" | "demo"): void; payer: PayerSigner | null }) {
  const vault = useVault();
  const demoAllowed = w.net.chain.id === DEMO_CHAIN_ID;
  const status = useQuery({
    queryKey: ["payer", w.net.chain.id, payer?.address],
    enabled: Boolean(payer),
    refetchInterval: 10_000,
    queryFn: async () => {
      if (!payer) throw new Error("no payer");
      const [reg, bal] = await Promise.all([
        w.payerId(payer.address),
        w.client.readContract({ address: TUSD8_ADDRESS, abi: balanceAbi, functionName: "balanceOf", args: [payer.address] }),
      ]);
      return { reg, balance: formatUnits(bal, 6) };
    },
  });

  return (
    <section className="card stack" aria-labelledby="payer">
      <h2 id="payer">Paying as</h2>
      {demoAllowed && (
        <div className="tabs" role="group" aria-label="Payer">
          <button className="btn ghost small" type="button" aria-pressed={prefer === "wallet"} onClick={() => setPrefer("wallet")}>Your wallet</button>
          <button className="btn ghost small" type="button" aria-pressed={prefer === "demo"} onClick={() => setPrefer("demo")}>{DEMO_PAYER_NAME}</button>
        </div>
      )}
      {prefer === "wallet" && !payer && (
        <div className="stack">
          <p className="sub">Connect a wallet on {w.net.chain.name}. It only signs; it never needs gas.</p>
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      )}
      {prefer === "demo" && !payer && (
        <div className="stack">
          <p className="sub">
            <span className="demo-tag">Demo</span> A payer key kept in this browser&apos;s vault, for the local fork only. It is refused on Aevum testnet.
          </p>
          <button className="btn secondary" type="button" onClick={() => void vault.update((d) => ({ ...d, demoPayerKey: generatePrivateKey() }))}>
            Create {DEMO_PAYER_NAME}
          </button>
        </div>
      )}
      {payer && (
        <dl className="lines">
          <div className="line"><dt>{payer.kind === "demo" ? <>{payer.label} <span className="demo-tag">Demo</span></> : payer.label}</dt><dd className="mono break">{payer.address}</dd></div>
          <div className="line"><dt>Registered payer</dt><dd>{!status.data ? "—" : "id" in status.data.reg ? `yes, #${status.data.reg.id}` : status.data.reg.error === "PayerNotRegistered" ? "no" : status.data.reg.error}</dd></div>
          <div className="line"><dt>Public tUSD8</dt><dd className="num">{status.data ? status.data.balance : "—"}</dd></div>
        </dl>
      )}
      {payer && status.data && !("id" in status.data.reg) && (
        <div className="notice warn">
          <span><strong className="mono">{status.data.reg.error === "PayerRevoked" ? "PayerRevoked" : "PayerNotRegistered"}</strong> Only registered payers can deposit or pay. An attestor registers payers; nothing was sent.</span>
          {demoAllowed && <span className="fine mono break">On the fork: make register-payer TO={payer.address} NAME=&quot;{payer.label}&quot; &amp;&amp; make deal TO={payer.address} AMOUNT=20</span>}
        </div>
      )}
    </section>
  );
}
