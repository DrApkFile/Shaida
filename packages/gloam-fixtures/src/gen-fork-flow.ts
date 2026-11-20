// Generates contracts/test/fixtures/fork-flow.json: real Gloam proofs, made with the FINAL ceremony keys,
// for one deposit -> vouched pay -> sweep (+ a payer clawback attempt) on a freshly deployed pool.
// A fresh pool's tree is deterministic, so the proofs replay in a Foundry fork test.
// Only public values are written: no note secrets leave this process.
// Run: pnpm --filter @shaida/gloam-fixtures gen:fork-flow
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IncrementalMerkleTreePoseidon,
  artifactProver,
  buildPrivateSendIntent,
  buildShieldBoundIntent,
  fieldToHex,
  hexToField,
  poseidon3,
} from "@gloamtrade/sdk";
import { z } from "zod";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CIRCUITS = join(REPO, "contracts/lib/gloam/app/public/circuits");
const OUT = join(REPO, "contracts/test/fixtures/fork-flow.json");

const AEVUM_FORK_CHAIN_ID = 440050 as const;
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
// Measured 2026-11-20: these match the IC constants of Gloam's *VerifierFinal contracts. The same-named files one
// directory up (circuits/shield_final.zkey, circuits/transfer_final.zkey) are a DIFFERENT key and fail on our pool.
const ARTIFACTS = {
  shield: {
    wasm: join(CIRCUITS, "shield.wasm"),
    zkey: join(CIRCUITS, "final/shield_final.zkey"),
    zkeySha256: "3054877c35e2e0e9f76c43aa4791ac2b3ac51b8967d51be2215e89c0a5fbb512",
  },
  transfer: {
    wasm: join(CIRCUITS, "transfer.wasm"),
    zkey: join(CIRCUITS, "final/transfer_final.zkey"),
    zkeySha256: "bdbae966705bc85e76571b4945da74a43fc4503a955fd4e3799358bcff749cdb",
  },
} as const;

/** The first payer the fork test registers gets id 1 (PayerRegistry ids start at 1). */
const PAYER_ID = 1n;
const DEPOSIT = 5_000_000n; // 5 tUSD8
const PAYMENT = 3_000_000n; // 3 tUSD8 to the recipient, 2 tUSD8 change to the payer
const VOUCH_TAG = 1n;
const SWEEP_TAG = 2n;
// A placeholder pool address: the SDK records it in the intent, but no circuit input depends on it.
const ANY_POOL = "0x0000000000000000000000000000000000000001" as const;

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const transferExec = z
  .object({
    fn: z.literal("transfer"),
    args: z.tuple([hex, bytes32, bytes32, z.tuple([bytes32, bytes32])]),
  })
  .passthrough();
const shieldExec = z
  .object({ fn: z.literal("shieldBound"), args: z.tuple([z.string(), z.bigint(), bytes32, hex]) })
  .passthrough();

function requirePinned(path: string, sha256: string): void {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== sha256) throw new Error(`${path}: sha256 ${actual}, expected ${sha256} (not the final ceremony key)`);
}

type TransferArgs = { proof: string; root: string; nullifier: string; newCommitments: [string, string] };

function transferArgs(exec: unknown): TransferArgs {
  const { args } = transferExec.parse(exec);
  return { proof: args[0], root: args[1], nullifier: args[2], newCommitments: args[3] };
}

async function main(): Promise<void> {
  requirePinned(ARTIFACTS.shield.zkey, ARTIFACTS.shield.zkeySha256);
  requirePinned(ARTIFACTS.transfer.zkey, ARTIFACTS.transfer.zkeySha256);
  const shieldProver = artifactProver({ wasm: ARTIFACTS.shield.wasm, zkey: ARTIFACTS.shield.zkey });
  const transferProver = artifactProver({ wasm: ARTIFACTS.transfer.wasm, zkey: ARTIFACTS.transfer.zkey });
  const common = { chainId: AEVUM_FORK_CHAIN_ID, poolAddress: ANY_POOL, asset: TUSD8 } as const;

  // Pool tree, mirrored off chain in insertion order (Shielded, then Transferred c0, c1).
  const pool = new IncrementalMerkleTreePoseidon();
  await pool.init();

  // 1. Payer deposit (leaf 0).
  const deposit = await buildShieldBoundIntent({ ...common, amountWei: DEPOSIT, prover: shieldProver });
  const depositArgs = shieldExec.parse(deposit.exec).args;
  await pool.insert(hexToField(deposit.note.commitment));

  // 2. Vouched pay: spend the deposit, 3 tUSD8 to the recipient (leaf 1), 2 tUSD8 change (leaf 2).
  const pay = await buildPrivateSendIntent({
    ...common,
    secretHex: deposit.note.secret,
    amountInWei: DEPOSIT,
    amountPayWei: PAYMENT,
    path: await pool.path(0),
    prove: transferProver,
  });
  const payArgs = transferArgs(pay.exec);
  await pool.insert(hexToField(payArgs.newCommitments[0]));
  await pool.insert(hexToField(payArgs.newCommitments[1]));

  // 3a. Payer clawback attempt: the payer created the payment note, so it can spend it too (same nullifier).
  const clawback = await buildPrivateSendIntent({
    ...common,
    secretHex: pay.paymentNote.secret,
    amountInWei: PAYMENT,
    amountPayWei: PAYMENT,
    path: await pool.path(1),
    prove: transferProver,
  });
  // 3b. Recipient sweep: the whole payment into a fresh note only the recipient knows (leaf 3), zero change (leaf 4).
  const sweep = await buildPrivateSendIntent({
    ...common,
    secretHex: pay.paymentNote.secret,
    amountInWei: PAYMENT,
    amountPayWei: PAYMENT,
    path: await pool.path(1),
    prove: transferProver,
  });
  const sweepArgs = transferArgs(sweep.exec);
  const clawbackArgs = transferArgs(clawback.exec);
  if (sweepArgs.nullifier !== clawbackArgs.nullifier) throw new Error("clawback must spend the same note");
  await pool.insert(hexToField(sweepArgs.newCommitments[0]));
  await pool.insert(hexToField(sweepArgs.newCommitments[1]));

  // Shaida ledger leaves (D3) and the ledger tree the contract must reproduce.
  const vLeaf = await poseidon3(VOUCH_TAG, PAYER_ID, hexToField(payArgs.newCommitments[0]));
  const sLeaf = await poseidon3(SWEEP_TAG, hexToField(sweepArgs.nullifier), hexToField(sweepArgs.newCommitments[0]));
  const ledger = new IncrementalMerkleTreePoseidon();
  await ledger.init();
  await ledger.insert(vLeaf);
  const ledgerRootAfterPay = ledger.currentRoot;
  await ledger.insert(sLeaf);

  const fixture = {
    generatedBy: "packages/gloam-fixtures/src/gen-fork-flow.ts",
    keys: {
      shieldZkeySha256: ARTIFACTS.shield.zkeySha256,
      transferZkeySha256: ARTIFACTS.transfer.zkeySha256,
    },
    asset: TUSD8,
    payerId: Number(PAYER_ID),
    deposit: { amount: depositArgs[1].toString(), commitment: depositArgs[2], proof: depositArgs[3] },
    pay: { ...payArgs, paymentAmount: PAYMENT.toString(), changeAmount: (DEPOSIT - PAYMENT).toString() },
    sweep: sweepArgs,
    clawback: clawbackArgs,
    expected: {
      vLeaf: fieldToHex(vLeaf),
      sLeaf: fieldToHex(sLeaf),
      ledgerRootAfterPay: fieldToHex(ledgerRootAfterPay),
      ledgerRootAfterSweep: fieldToHex(ledger.currentRoot),
      poolRootAfterSweep: fieldToHex(pool.currentRoot),
    },
  };
  writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${OUT.slice(REPO.length + 1)}`);
}

main().then(
  // snarkjs keeps worker threads alive after proving: exit explicitly.
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
