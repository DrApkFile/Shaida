// Where the ceremony reads and writes, and the values it pins. A real run uses ceremony/ in the repo; setting
// CEREMONY_DIR runs a DRY RUN in that directory instead (rehearsal: test entropy and a fork RPC allowed, nothing
// written to the repo, every file marked as a dry run).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CEREMONY_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = resolve(CEREMONY_SRC, "..");

/** income.circom = Income(4, 20), circom 2.2.3 --O2 (D12, frozen by D13). */
export const R1CS = join(REPO, "packages/shaida-proofs/build/income.r1cs");
export const R1CS_SHA256 = "d866695ca2473e70408d288feafaec7181983480a688acac30b42156d305d82a";
export const WASM = join(REPO, "packages/shaida-proofs/build/income_js/income.wasm");

/** Hermez powersOfTau28_hez_final_17.ptau (briefing/CEREMONY.md, phase 1). */
export const PTAU_NAME = "powersOfTau28_hez_final_17.ptau";
export const PTAU_BLAKE2B =
  "6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345";

export const SNARKJS_VERSION = "0.7.6";

/** Aevum testnet. The beacon block hash is read from here. */
export const AEVUM_CHAIN_ID = 44005;
export const AEVUM_RPC_DEFAULT = "https://rpc-test.qday.info";
/** `make fork`: allowed for the beacon only in a dry run. */
export const FORK_CHAIN_ID = 440050;
/** Measured block time (REALITY_SPIKES S3: 1,000 blocks in 1,012 s). */
export const BLOCK_SECONDS = 1.012;
/** The beacon block is picked this long after the last contribution (briefing/CEREMONY.md). */
export const BEACON_DELAY_HOURS = 2;
/** Blocks the beacon block must be buried under before its hash is used. */
export const BEACON_CONFIRMATIONS = 64;
/** snarkjs `zkey beacon` iterations exponent (2^10 hash iterations). */
export const BEACON_ITERATIONS_EXP = 10;
/** Contributions (besides the beacon) required before the beacon can be announced. */
export const MIN_CONTRIBUTIONS = 2;

export interface CeremonyPaths {
  readonly dryRun: boolean;
  readonly root: string;
  readonly work: string;
  readonly record: string;
  readonly transcript: string;
  readonly logs: string;
  /** Where finalize puts the verification key and the Solidity verifier. */
  readonly vkeyOut: string;
  readonly verifierOut: string;
  readonly forge: string;
}

export function ceremonyPaths(env: NodeJS.ProcessEnv = process.env): CeremonyPaths {
  const dir = env.CEREMONY_DIR;
  if (dir !== undefined && dir !== "") {
    const root = resolve(dir);
    if (root === CEREMONY_SRC) throw new Error("CEREMONY_DIR must not be ceremony/ itself: unset it for the real ceremony.");
    return {
      dryRun: true,
      root,
      work: join(root, "work"),
      record: join(root, "record.json"),
      transcript: join(root, "TRANSCRIPT.md"),
      logs: join(root, "logs"),
      vkeyOut: join(root, "out/income_final_vkey.json"),
      verifierOut: join(root, "out/IncomeGroth16Verifier.sol"),
      forge: join(root, "forge"),
    };
  }
  return {
    dryRun: false,
    root: CEREMONY_SRC,
    work: join(CEREMONY_SRC, "work"),
    record: join(CEREMONY_SRC, "record.json"),
    transcript: join(CEREMONY_SRC, "TRANSCRIPT.md"),
    logs: join(CEREMONY_SRC, "logs"),
    vkeyOut: join(REPO, "packages/shaida-proofs/keys/income_final_vkey.json"),
    verifierOut: join(REPO, "contracts/src/generated/IncomeGroth16Verifier.sol"),
    forge: join(CEREMONY_SRC, "work/forge"),
  };
}

export function requireFile(path: string, what: string): string {
  if (!existsSync(path)) throw new Error(`${what} not found at ${path}`);
  return path;
}
