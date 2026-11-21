"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useVault } from "@/lib/vault";

/** Shows its children only once this browser's vault is open. Secrets never leave the browser. */
export function VaultGate({ children, purpose }: { children: ReactNode; purpose: string }) {
  const v = useVault();
  const [pass, setPass] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  if (v.status === "open") return <>{children}</>;
  if (v.status === "loading") return <div className="card"><p className="sub">Opening…</p></div>;
  if (v.status === "unavailable") return <div className="notice bad" role="alert">{v.problem}</div>;

  const fresh = v.status === "none";
  const run = (f: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await f(); } finally { setBusy(false); setPass(""); }
  };

  return (
    <div className="card stack">
      <h2>{fresh ? "Create your vault" : "Unlock your vault"}</h2>
      <p className="sub">
        {purpose} They are encrypted with your passphrase and kept only in this browser. Shaida&apos;s server never sees them. If you
        lose both this browser&apos;s data and your backup file, the money in them is lost.
      </p>
      <form className="stack" onSubmit={run(() => (fresh ? v.create(pass) : v.unlock(pass)))}>
        <label className="field">
          <span>Passphrase{fresh ? " (8+ characters)" : ""}</span>
          <input type="password" autoComplete={fresh ? "new-password" : "current-password"} value={pass} minLength={8} required onChange={(e) => setPass(e.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={busy || pass.length < 8}>{busy ? "Working…" : fresh ? "Create vault" : "Unlock"}</button>
      </form>
      <details>
        <summary>Restore from a backup file</summary>
        <form className="stack" onSubmit={run(async () => { if (file) await v.importBackup(file, pass); })}>
          <input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {!fresh && (
            <label className="check-line">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the vault already in this browser
            </label>
          )}
          <button className="btn ghost" type="submit" disabled={busy || !file || pass.length < 8 || (!fresh && !replace)}>Restore (uses the passphrase above)</button>
        </form>
      </details>
      {v.problem && <div className="notice bad" role="alert">{v.problem}</div>}
    </div>
  );
}

export function VaultBar() {
  const v = useVault();
  if (v.status !== "open") return null;
  return (
    <div className="row-between vault-bar">
      <span className="sub">Vault open in this tab · encrypted in this browser only</span>
      <span className="row">
        <button className="btn ghost small" type="button" onClick={v.exportBackup}>Export backup</button>
        <button className="btn ghost small" type="button" onClick={v.lock}>Lock</button>
      </span>
    </div>
  );
}
