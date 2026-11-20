// Spike S8 page: builds random valid witnesses here, proves them in a Web Worker, shows and exports the timings.
// ?auto=1&runs=N&label=... starts on load (used by headless.ts); window.__s8 holds the report when done.
import type { RunRequest, Timings, Variant, WorkerReply } from "./messages.js";
import { randomFullWitness } from "./random-witness.js";

interface RunRow extends Timings {
  readonly variant: Variant;
  readonly run: number;
  readonly inputMs: number;
}
export interface S8Report {
  readonly schema: "shaida-s8/1";
  readonly label: string;
  readonly userAgent: string;
  readonly hardwareConcurrency: number | null;
  readonly deviceMemoryGiB: number | null;
  readonly manifest: unknown;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly runs: RunRow[];
  readonly errors: string[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SLOTS: Record<Variant, number> = { income8: 8, income4: 4 };
const params = new URLSearchParams(location.search);
const ms = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(2)} s`);
const nav = navigator as Navigator & { deviceMemory?: number };

$("ua").textContent = navigator.userAgent;
$("cores").textContent = String(navigator.hardwareConcurrency ?? "—");
$("mem").textContent = nav.deviceMemory === undefined ? "—" : `${nav.deviceMemory} GiB (browser-rounded)`;
($("label") as HTMLInputElement).value = params.get("label") ?? "";
if (params.get("runs")) ($("runs") as HTMLInputElement).value = params.get("runs")!;
const manifest: Promise<unknown> = fetch("manifest.json").then((r) => r.json());

const worker = new Worker("worker.js");
function prove(variant: Variant, input: RunRequest["input"]): Promise<Timings> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerReply>) =>
      e.data.type === "result" ? resolve(e.data.timings) : reject(new Error(e.data.message));
    const req: RunRequest = { type: "run", variant, input };
    worker.postMessage(req);
  });
}

function addRow(r: RunRow): void {
  const tr = document.createElement("tr");
  const cells = [
    `${SLOTS[r.variant]}`,
    `${r.run}${r.cold ? " (cold)" : ""}`,
    ms(r.inputMs),
    ms(r.witnessMs),
    ms(r.proveMs),
    ms(r.verifyMs),
    ms(r.totalMs),
    ms(r.zkeyLoadMs),
    r.verified ? "✓" : "✗",
  ];
  for (const c of cells) tr.appendChild(Object.assign(document.createElement("td"), { textContent: c }));
  $("rows").appendChild(tr);
}

async function runAll(): Promise<void> {
  const runs = Math.max(1, Math.min(10, Number(($("runs") as HTMLInputElement).value) || 3));
  const label = ($("label") as HTMLInputElement).value.trim();
  $<HTMLButtonElement>("start").disabled = true;
  $("rows").replaceChildren();
  const startedAt = new Date().toISOString();
  const rows: RunRow[] = [];
  const errors: string[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const variant of ["income8", "income4"] as const) {
      $("status").textContent = `Proving ${SLOTS[variant]} slots, run ${run} of ${runs}…`;
      try {
        const t = performance.now();
        const input = randomFullWitness(SLOTS[variant]);
        const inputMs = performance.now() - t;
        const row: RunRow = { variant, run, inputMs, ...(await prove(variant, input)) };
        rows.push(row);
        addRow(row);
      } catch (e) {
        errors.push(`${variant} run ${run}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const report: S8Report = {
    schema: "shaida-s8/1",
    label,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: nav.deviceMemory ?? null,
    manifest: await manifest,
    startedAt,
    finishedAt: new Date().toISOString(),
    runs: rows,
    errors,
  };
  $("status").textContent = errors.length ? `Done with ${errors.length} error(s): ${errors.join("; ")}` : "Done.";
  $("json").textContent = JSON.stringify(report, null, 2);
  $<HTMLButtonElement>("copy").disabled = false;
  $<HTMLButtonElement>("save").disabled = false;
  $<HTMLButtonElement>("start").disabled = false;
  (window as Window & { __s8?: S8Report }).__s8 = report;
  // serve.ts saves it into results/; a plain static server answers 404/405 and the JSON stays on this page.
  try {
    const res = await fetch("results", { method: "POST", headers: { "content-type": "application/json" }, body: $("json").textContent });
    $("saved").textContent = res.ok ? "Saved to tools/s8-bench/results/ on the server." : `Not saved (${res.status}): use Download JSON.`;
  } catch (e) {
    $("saved").textContent = `Not saved (${e instanceof Error ? e.message : String(e)}): use Download JSON.`;
  }
}

$("start").addEventListener("click", () => void runAll());
$("copy").addEventListener("click", () => void navigator.clipboard?.writeText($("json").textContent ?? ""));
$("save").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([$("json").textContent ?? ""], { type: "application/json" }));
  a.download = `s8-${Date.now()}.json`;
  a.click();
});
if (params.get("auto") === "1") void runAll();
