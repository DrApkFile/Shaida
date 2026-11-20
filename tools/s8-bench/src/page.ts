// Spike S8 page: builds random valid witnesses here, proves each in a fresh Web Worker, shows and exports the timings.
// The report is saved after every run (a stalled run keeps the runs before it), and `complete` says whether the
// whole plan finished. Query: ?slots=4|8 (one variant; default both), ?runs=N, ?label=..., ?auto=1 (start on load),
// ?nosave=1 (headless.ts saves the report itself). window.__s8 holds the report when complete.
import type { RunRequest, Timings, Variant, WorkerReply } from "./messages.js";
import { randomFullWitness } from "./random-witness.js";

interface RunRow extends Timings {
  readonly variant: Variant;
  readonly run: number;
  readonly inputMs: number;
}
export interface S8Report {
  readonly schema: "shaida-s8/2";
  /** Same id for every save of one page run: serve.ts overwrites results/<reportId>.json. */
  readonly reportId: string;
  readonly complete: boolean;
  readonly workerPerRun: true;
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
const VARIANTS: Record<string, readonly Variant[]> = { both: ["income4", "income8"], "4": ["income4"], "8": ["income8"] };
const params = new URLSearchParams(location.search);
const ms = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(2)} s`);
const nav = navigator as Navigator & { deviceMemory?: number };

$("ua").textContent = navigator.userAgent;
$("cores").textContent = String(navigator.hardwareConcurrency ?? "—");
$("mem").textContent = nav.deviceMemory === undefined ? "—" : `${nav.deviceMemory} GiB (browser-rounded)`;
($("label") as HTMLInputElement).value = params.get("label") ?? "";
if (params.get("runs")) ($("runs") as HTMLInputElement).value = params.get("runs")!;
const slotsParam = params.get("slots") ?? "both";
if (!(slotsParam in VARIANTS)) $("status").textContent = `Unknown ?slots=${slotsParam}: use 4, 8 or leave it out.`;
else ($("slots") as HTMLSelectElement).value = slotsParam;
const manifest: Promise<unknown> = fetch("manifest.json").then((r) => r.json());

/** One worker per run: nothing (wasm, zkey, curve, heap) carries over, and its memory is freed after. */
function prove(variant: Variant, input: RunRequest["input"]): Promise<Timings> {
  const worker = new Worker("worker.js");
  return new Promise<Timings>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerReply>) =>
      e.data.type === "result" ? resolve(e.data.timings) : reject(new Error(e.data.message));
    worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
    const req: RunRequest = { type: "run", variant, input };
    worker.postMessage(req);
  }).finally(() => worker.terminate());
}

function addRow(r: RunRow): void {
  const tr = document.createElement("tr");
  const cells = [`${SLOTS[r.variant]}`, `${r.run}`, ms(r.inputMs), ms(r.witnessMs), ms(r.proveMs), ms(r.verifyMs), ms(r.totalMs), ms(r.zkeyLoadMs), r.verified ? "✓" : "✗"];
  for (const c of cells) tr.appendChild(Object.assign(document.createElement("td"), { textContent: c }));
  $("rows").appendChild(tr);
}

async function save(report: S8Report): Promise<void> {
  $("json").textContent = JSON.stringify(report, null, 2);
  if (params.get("nosave") === "1") return;
  // serve.ts saves it into results/; a plain static server answers 404/405 and the JSON stays on this page.
  try {
    const res = await fetch("results", { method: "POST", headers: { "content-type": "application/json" }, body: $("json").textContent });
    const what = report.complete ? "complete report" : `${report.runs.length} run(s) so far`;
    $("saved").textContent = res.ok ? `Saved (${what}) to tools/s8-bench/results/ on the server.` : `Not saved (${res.status}): use Download JSON.`;
  } catch (e) {
    $("saved").textContent = `Not saved (${e instanceof Error ? e.message : String(e)}): use Download JSON.`;
  }
}

async function runAll(): Promise<void> {
  const runs = Math.max(1, Math.min(10, Number(($("runs") as HTMLInputElement).value) || 3));
  const variants = VARIANTS[($("slots") as HTMLSelectElement).value] ?? VARIANTS.both!;
  const label = ($("label") as HTMLInputElement).value.trim();
  $<HTMLButtonElement>("start").disabled = true;
  $("rows").replaceChildren();
  const startedAt = new Date().toISOString();
  const reportId = `${startedAt.replace(/[:.]/g, "-")}-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(16).padStart(8, "0")}`;
  const rows: RunRow[] = [];
  const errors: string[] = [];
  const report = (complete: boolean): S8Report => ({
    schema: "shaida-s8/2",
    reportId,
    complete,
    workerPerRun: true,
    label,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: nav.deviceMemory ?? null,
    manifest: null,
    startedAt,
    finishedAt: new Date().toISOString(),
    runs: [...rows],
    errors: [...errors],
  });
  const withManifest = async (complete: boolean) => ({ ...report(complete), manifest: await manifest });
  for (let run = 1; run <= runs; run++) {
    for (const variant of variants) {
      $("status").textContent = `Proving ${SLOTS[variant]} slots, run ${run} of ${runs} (fresh worker)…`;
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
      await save(await withManifest(false));
    }
  }
  const final = await withManifest(true);
  $("status").textContent = errors.length ? `Done with ${errors.length} error(s): ${errors.join("; ")}` : "Done.";
  $<HTMLButtonElement>("copy").disabled = false;
  $<HTMLButtonElement>("save").disabled = false;
  $<HTMLButtonElement>("start").disabled = false;
  await save(final);
  (window as Window & { __s8?: S8Report }).__s8 = final;
}

$("start").addEventListener("click", () => void runAll());
$("copy").addEventListener("click", () => void navigator.clipboard?.writeText($("json").textContent ?? ""));
$("save").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([$("json").textContent ?? ""], { type: "application/json" }));
  a.download = `s8-${Date.now()}.json`;
  a.click();
});
if (params.get("auto") === "1" && slotsParam in VARIANTS) void runAll();
