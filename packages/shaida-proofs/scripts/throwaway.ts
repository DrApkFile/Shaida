// THROWAWAY Groth16 key for local tests and timing only: one phase-2 contribution with random entropy, made and
// kept on this machine (build/throwaway/, gitignored). Whoever ran it could forge proofs, so it is never deployed
// and never published. The real key comes from the multi-party ceremony (briefing/CEREMONY.md, PRD §11 step 3).
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD, PKG } from "../test/helpers/circuit";

/** Hermez powersOfTau28_hez_final_17.ptau, blake2b-512 as listed by snarkjs and checked in briefing/CEREMONY.md. */
export const PTAU_17_BLAKE2B =
  "6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345";

export const THROWAWAY = join(BUILD, "throwaway");
const SNARKJS_CLI = join(PKG, "node_modules/snarkjs/build/cli.cjs");

/** Which circuit to key. The default is income.circom (4 slots, D12); spike S8 also keys its 8-slot variant. */
export interface KeyTarget {
  readonly r1cs: string;
  readonly dir: string;
  readonly name: string;
}
export const INCOME_MAIN: KeyTarget = { r1cs: join(BUILD, "income.r1cs"), dir: THROWAWAY, name: "income" };

export interface ThrowawayKey {
  readonly zkey: string;
  readonly vkey: string;
  readonly verifierSol: string;
  /** Wall time of setup + contribution in this call, or null when an up-to-date key was reused. */
  readonly setupMs: number | null;
}

async function blake2b(file: string): Promise<string> {
  const h = createHash("blake2b512");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

function snarkjs(args: string[]): void {
  const run = spawnSync(process.execPath, [SNARKJS_CLI, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (run.status !== 0) throw new Error(`snarkjs ${args.join(" ")} exited ${run.status}:\n${run.stdout}\n${run.stderr}`);
}

/** Verifies the ptau hash, then builds (or reuses, if made from this exact r1cs) the throwaway key. */
export async function ensureThrowawayKey(ptauPath: string, target: KeyTarget = INCOME_MAIN): Promise<ThrowawayKey> {
  const { r1cs: R1CS, dir: THROWAWAY, name } = target;
  if (!existsSync(R1CS)) throw new Error(`${R1CS} is missing: compile the circuit first`);
  const ptauHash = await blake2b(ptauPath);
  if (ptauHash !== PTAU_17_BLAKE2B) throw new Error(`${ptauPath}: blake2b ${ptauHash} is not the Hermez 2^17 ptau`);

  const r1csSha256 = createHash("sha256").update(readFileSync(R1CS)).digest("hex");
  const key = {
    zkey: join(THROWAWAY, `${name}_THROWAWAY.zkey`),
    vkey: join(THROWAWAY, `${name}_THROWAWAY_vkey.json`),
    verifierSol: join(THROWAWAY, `${name}_VerifierThrowaway.sol`),
  };
  const stampFile = join(THROWAWAY, "stamp.json");
  const stamp = existsSync(stampFile) ? (JSON.parse(readFileSync(stampFile, "utf8")) as { r1csSha256?: string }) : {};
  if (stamp.r1csSha256 === r1csSha256 && Object.values(key).every((f) => existsSync(f))) {
    return { ...key, setupMs: null };
  }

  rmSync(THROWAWAY, { recursive: true, force: true });
  mkdirSync(THROWAWAY, { recursive: true });
  const t0 = performance.now();
  const initial = join(THROWAWAY, `${name}_0000.zkey`);
  snarkjs(["groth16", "setup", R1CS, ptauPath, initial]);
  snarkjs([
    "zkey",
    "contribute",
    initial,
    key.zkey,
    "--name=THROWAWAY local test key, not a ceremony",
    `-e=${randomBytes(32).toString("hex")}`,
  ]);
  const setupMs = performance.now() - t0;
  rmSync(initial);
  snarkjs(["zkey", "export", "verificationkey", key.zkey, key.vkey]);
  snarkjs(["zkey", "export", "solidityverifier", key.zkey, key.verifierSol]);
  writeFileSync(stampFile, JSON.stringify({ r1csSha256, ptauBlake2b: ptauHash, note: "THROWAWAY: never deploy" }));
  return { ...key, setupMs };
}
