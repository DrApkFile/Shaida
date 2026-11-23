// Landing (D26). Server-rendered; every fact on it comes from a file in this repo (ceremony/record.json, LIMITS.md)
// or the build's config. No stats or testimonials; the example link and personas are labelled demo.
import Link from "next/link";
import record from "../../../ceremony/record.json";
import { ArrowRightIcon, ArrowUpRightIcon, InboxIcon, LinkIcon, ProofIcon, SealedLetter } from "@/components/Icons";
import { defaultNetwork, repoUrl } from "@/lib/env";
import examples from "./example-links.json";
import "./landing.css";

const chain = record.verified.at(-1)?.contributions ?? [];
const people = chain.filter((c) => !c.name.startsWith("Aevum "));
// The example is a real run's /v link per chain (example-links.json, written by scripts/live-44005.ts); an env value
// overrides it for chains with no recorded run (the fork). The page is prerendered, so the expiry is checked at build:
// a build after the expiry offers no example; before a rebuild, /v itself reports the link as expired.
const recorded = (examples as Record<string, { link: string; expiry: number } | string>)[String(defaultNetwork.chain.id)];
const fromRun = typeof recorded === "object" && recorded.expiry * 1000 > Date.now() ? recorded : null;
const example = fromRun?.link ?? (process.env.NEXT_PUBLIC_SHAIDA_EXAMPLE_LINK?.trim() || null);
const exampleExpires = fromRun ? new Date(fromRun.expiry * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;

const STEPS = [
  { icon: <InboxIcon size={22} />, title: "Get paid privately", text: "A registered payer pays your receive address from Gloam's private pool. The chain shows that a registered payer paid someone, not who or how much." },
  { icon: <ProofIcon size={22} />, title: "Sweep", text: "Move each payment into a fresh note only you know. Until then the payer could take it back; after, it is yours alone and it counts." },
  { icon: <LinkIcon size={22} />, title: "Share a proof link", text: "Pick a period, an amount and one reader. Your browser makes a zero-knowledge proof; the reader opens the link and sees VALID, or why not." },
] as const;

const WHO = [
  { tone: "tone-lemon", title: "Freelancers", text: "Show a landlord you earn enough for the rent, without handing over a bank statement with every client on it.", href: "/app/prove", cta: "Income proof for a landlord" },
  { tone: "tone-sage", title: "Merchants", text: "Show a supplier or a lender steady income over a quarter, without showing which customers paid.", href: "/app/prove?for=merchant", cta: "Revenue proof for a lender" },
  { tone: "tone-rose", title: "Grantees", text: "Show a programme you received the tranches you were promised, without publishing your wallet.", href: "/app/prove?for=grantee", cta: "Disbursements for a donor or sponsor" },
] as const;

const LIMITS = [
  "Testnet only: Aevum testnet (chain 44005) with tUSD8. Not audited.",
  "tUSD8's issuer can pause the token or block an address; Shaida cannot stop that.",
  "Only payments from registered payers, swept by you, count. A payment you made to yourself does not.",
  "A reader's name binds intent, not identity: anyone with the link who types the name sees VALID. Keep links private; they expire.",
] as const;

export default function LandingPage() {
  return (
    <main className="landing">
      <section className="shell hero">
        <div className="hero-copy">
          <p className="eyebrow">Private payroll proofs on Aevum</p>
          <h1>Get paid privately, prove you earn enough, show nothing else</h1>
          <p className="lede">Shaida keeps who paid you and how much off the public chain, and lets you prove a total to one person, for a while, when you choose.</p>
          <div className="row hero-ctas">
            <Link className="btn big" href="/app">Open the dashboard <ArrowRightIcon /></Link>
            {example ? (
              <a className="btn big secondary" href={example}>See a live proof <span className="demo-tag">Demo</span></a>
            ) : (
              <span className="btn big secondary" aria-disabled="true">No live example on this network yet</span>
            )}
          </div>
          {example && <p className="fine">The example is a real proof on this network for the demo personas Ada (demo) and Landlord Bola (demo): open it and type “Landlord Bola”.{exampleExpires && ` It expires ${exampleExpires}.`}</p>}
        </div>
        <div className="hero-art card tone-ink" aria-hidden="true"><SealedLetter size={180} /></div>
      </section>

      <section className="shell band" aria-labelledby="how">
        <h2 id="how" className="band-title">How it works</h2>
        <ol className="how">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card stack">
              <div className="row-between"><span className="how-num">{i + 1}</span><span className="how-icon">{s.icon}</span></div>
              <h3>{s.title}</h3>
              <p className="sub">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="shell band" aria-labelledby="who">
        <h2 id="who" className="band-title">Who it is for</h2>
        <div className="who">
          {WHO.map((w) => (
            <div key={w.title} className={`card stack ${w.tone}`}>
              <h3>{w.title}</h3>
              <p className="sub">{w.text}</p>
              <Link className="btn secondary small" href={w.href}>{w.cta} <ArrowRightIcon /></Link>
            </div>
          ))}
        </div>
        <p className="fine who-bot">
          Landlords and lenders who read many proofs can let a bot do it: the <Link href="/underwrite">underwriting bot</Link> checks a link against a
          published policy and answers APPROVE, DECLINE with reasons, or INCONCLUSIVE. Deterministic, no LLM; agents can call it too (<a href="/llms.txt">llms.txt</a>).
        </p>
      </section>

      <section className="shell band" aria-labelledby="trust">
        <h2 id="trust" className="band-title">Why you can check it</h2>
        <div className="trust">
          <div className="card stack">
            <h3>A public key ceremony</h3>
            <p className="sub">The proving key was made by {people.length} named contributor{people.length === 1 ? "" : "s"} and sealed with a public randomness beacon. Forging a proof would need every contributor's secret: one contributor who deleted theirs is enough to make it impossible.</p>
            <dl className="kv">
              <dt>Contributors</dt><dd>{people.map((p) => p.name).join(", ")}</dd>
              <dt>Beacon</dt><dd>Aevum 44005 block {record.beacon.blockNumber}, hash <span className="mono break">{record.beacon.blockHash.slice(0, 18)}…</span></dd>
              <dt>Final key</dt><dd className="mono break">sha256 {record.final.zkey.sha256.slice(0, 16)}…</dd>
            </dl>
            <a className="btn secondary small" href={`${repoUrl}/releases/tag/ceremony-v1`}>Ceremony release <ArrowUpRightIcon size={16} /></a>
          </div>
          <div className="card stack">
            <h3>Open source</h3>
            <p className="sub">Contracts, circuit, ceremony transcript and this app are public. Built on Gloam&apos;s private pool (MIT) and the Aevum Starter Kit (MIT).</p>
            <a className="btn secondary small" href={repoUrl}>Source on GitHub <ArrowUpRightIcon size={16} /></a>
          </div>
          <div className="card stack tone-peach">
            <h3>Limits, stated plainly</h3>
            <ul>{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
            <a className="btn secondary small" href={`${repoUrl}/blob/master/LIMITS.md`}>All limits <ArrowUpRightIcon size={16} /></a>
          </div>
        </div>
      </section>

      <section className="shell band">
        <div className="card tone-ink strip">
          <h2>Ready when your next invoice is paid</h2>
          <Link className="btn lemon big" href="/app">Open the dashboard <ArrowRightIcon /></Link>
        </div>
      </section>
    </main>
  );
}
