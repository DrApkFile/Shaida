// The snarkjs 0.7.6 calls the ceremony makes (GPL-3.0, iden3; installed from npm, not copied). Library calls for
// the steps whose return value matters (contribution hashes, verify result); the CLI for the Solidity export, which
// needs the package's templates. Every call's log is captured and kept.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as snarkjs from "snarkjs";
import { SNARKJS_VERSION } from "./config.js";
import { parseVerifyLog, type ParsedVerifyLog } from "./verify-log.js";

/** snarkjs's package root, found from its main entry (it does not export ./package.json). */
function packageRoot(): string {
  let dir = dirname(createRequire(import.meta.url).resolve("snarkjs"));
  while (!existsSync(join(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("snarkjs package.json not found");
    dir = up;
  }
  return dir;
}
const PACKAGE_JSON = join(packageRoot(), "package.json");
const CLI = join(dirname(PACKAGE_JSON), "build/cli.cjs");

export function assertSnarkjsVersion(): void {
  const { version } = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { version: string };
  if (version !== SNARKJS_VERSION) throw new Error(`snarkjs ${version} is installed; the ceremony pins ${SNARKJS_VERSION}.`);
}

/** A logger that prints and keeps every line (debug lines are kept but not printed). */
export class CapturingLogger implements snarkjs.Logger {
  readonly lines: string[] = [];
  constructor(private readonly echo: boolean = true) {}
  private add(level: string, msg: string, print: boolean) {
    this.lines.push(`[${level}] ${msg}`);
    if (this.echo && print) console.log(msg);
  }
  info = (msg: string) => this.add("INFO", msg, true);
  warn = (msg: string) => this.add("WARN", msg, true);
  error = (msg: string) => this.add("ERROR", msg, true);
  debug = (msg: string) => this.add("DEBUG", msg, false);
  text = () => `${this.lines.join("\n")}\n`;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

export async function newZkey(r1cs: string, ptau: string, out: string, logger: CapturingLogger): Promise<void> {
  await snarkjs.zKey.newZKey(r1cs, ptau, out, logger);
}

/** Returns the 64-byte contribution hash as hex. */
export async function contribute(input: string, output: string, name: string, entropy: string, logger: CapturingLogger): Promise<string> {
  const hash = await snarkjs.zKey.contribute(input, output, name, entropy, logger);
  return hex(hash);
}

/** Returns the contribution hash; snarkjs returns false (no throw) on a bad beacon value or exponent. */
export async function beacon(input: string, output: string, name: string, beaconHex: string, iterationsExp: number, logger: CapturingLogger): Promise<string> {
  const hash = await snarkjs.zKey.beacon(input, output, name, beaconHex, iterationsExp, logger);
  if (hash === false) throw new Error(`snarkjs refused the beacon (value ${beaconHex}, 2^${iterationsExp}):\n${logger.text()}`);
  return hex(hash);
}

export type VerifyOutcome = ({ readonly ok: true } & ParsedVerifyLog) | { readonly ok: false; readonly why: string };

/** `zkey verify` against the r1cs and ptau. ok only if snarkjs returned true and the log parses completely. */
export async function verifyFromR1cs(r1cs: string, ptau: string, zkey: string, logger: CapturingLogger): Promise<VerifyOutcome> {
  const result = await snarkjs.zKey.verifyFromR1cs(r1cs, ptau, zkey, logger);
  if (result !== true) return { ok: false, why: "snarkjs zkey verify returned false" };
  const parsed = parseVerifyLog(logger.lines);
  return parsed.ok ? { ok: true, ...parsed.value } : { ok: false, why: parsed.why };
}

export async function exportVerificationKey(zkey: string): Promise<unknown> {
  return snarkjs.zKey.exportVerificationKey(zkey);
}

export function exportSolidityVerifier(zkey: string, out: string): void {
  const run = spawnSync(process.execPath, [CLI, "zkey", "export", "solidityverifier", zkey, out], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`snarkjs zkey export solidityverifier exited ${run.status}:\n${run.stdout}${run.stderr}`);
}

export const groth16 = snarkjs.groth16;
