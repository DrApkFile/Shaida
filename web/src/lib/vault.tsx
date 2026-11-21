"use client";
// The browser vault (PRD §3: recipient secrets stay in the browser). Only the AES-GCM blob is stored; the
// passphrase lives in memory for this tab. Nothing in here is ever sent to the server or logged.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { emptyVault, openVault, sealVault, type VaultData } from "@shaida/pay";
import { useNetwork } from "./network";

type Status = "loading" | "none" | "locked" | "open" | "unavailable";

interface VaultState {
  status: Status;
  data: VaultData | null;
  /** Why storage or unlocking failed, in plain words. */
  problem: string | null;
  create(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  /** Applies `f`, re-seals and saves. Resolves only once the new blob is stored. */
  update(f: (d: VaultData) => VaultData): Promise<VaultData>;
  /** The sealed blob as a file the user keeps (it needs the passphrase to open). */
  exportBackup(): void;
  importBackup(file: File, passphrase: string): Promise<void>;
}

const Ctx = createContext<VaultState | null>(null);
const keyFor = (chainId: number) => `shaida:vault:${chainId}`;

function readStored(chainId: number): { ok: true; raw: string | null } | { ok: false; problem: string } {
  try {
    return { ok: true, raw: window.localStorage.getItem(keyFor(chainId)) };
  } catch (e) {
    return { ok: false, problem: `This browser blocks local storage (${e instanceof Error ? e.name : "error"}), so secrets can't be kept here. Use a normal window.` };
  }
}

function writeStored(chainId: number, blob: unknown): void {
  // A failed write throws on purpose: the caller must not go on as if the secret were saved.
  window.localStorage.setItem(keyFor(chainId), JSON.stringify(blob));
}

const REASONS = { "not-a-vault": "That file is not a Shaida backup.", "wrong-passphrase": "Wrong passphrase (or the backup was changed). Nothing was opened.", corrupt: "The backup opened but its contents are damaged." } as const;

export function VaultProvider({ children }: { children: ReactNode }) {
  const { net } = useNetwork();
  const chainId = net.chain.id;
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<VaultData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pass = useRef<string | null>(null);
  const latest = useRef<VaultData | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    pass.current = null;
    latest.current = null;
    setData(null);
    const s = readStored(chainId);
    if (!s.ok) { setProblem(s.problem); setStatus("unavailable"); return; }
    setProblem(null);
    setStatus(s.raw ? "locked" : "none");
  }, [chainId]);

  const show = (d: VaultData) => { latest.current = d; setData(d); setStatus("open"); setProblem(null); };

  const create = useCallback(async (passphrase: string) => {
    const d = emptyVault(chainId);
    writeStored(chainId, await sealVault(d, passphrase));
    pass.current = passphrase;
    show(d);
  }, [chainId]);

  const openWith = useCallback(async (raw: unknown, passphrase: string, save: boolean) => {
    const r = await openVault(raw, passphrase);
    if (!r.ok) { setProblem(REASONS[r.reason]); return; }
    if (r.data.chainId !== chainId) { setProblem(`This backup is for chain ${r.data.chainId}, not ${chainId}. Nothing was opened.`); return; }
    if (save) writeStored(chainId, raw);
    pass.current = passphrase;
    show(r.data);
  }, [chainId]);

  const unlock = useCallback(async (passphrase: string) => {
    const s = readStored(chainId);
    if (!s.ok || !s.raw) { setProblem(s.ok ? "No vault in this browser yet." : s.problem); return; }
    await openWith(JSON.parse(s.raw) as unknown, passphrase, false);
  }, [chainId, openWith]);

  const update = useCallback((f: (d: VaultData) => VaultData) => {
    const run = queue.current.then(async () => {
      const cur = latest.current;
      if (!cur || !pass.current) throw new Error("The vault is locked; nothing was saved.");
      const next = f(cur);
      writeStored(chainId, await sealVault(next, pass.current));
      show(next);
      return next;
    });
    queue.current = run.catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
    return run;
  }, [chainId]);

  const exportBackup = useCallback(() => {
    const s = readStored(chainId);
    if (!s.ok || !s.raw) { setProblem(s.ok ? "Nothing to back up yet." : s.problem); return; }
    const url = URL.createObjectURL(new Blob([s.raw], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `shaida-vault-${chainId}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }, [chainId]);

  const importBackup = useCallback(async (file: File, passphrase: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setProblem(REASONS["not-a-vault"]); // not JSON at all: the same answer as any other non-backup file
      return;
    }
    await openWith(raw, passphrase, true);
  }, [openWith]);

  const lock = useCallback(() => { pass.current = null; latest.current = null; setData(null); setStatus("locked"); }, []);

  const value = useMemo(() => ({ status, data, problem, create, unlock, lock, update, exportBackup, importBackup }), [status, data, problem, create, unlock, lock, update, exportBackup, importBackup]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVault(): VaultState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVault outside VaultProvider");
  return v;
}
