// Runs one ceremony step: prints the failure and exits 1, or exits 0. snarkjs keeps Node alive after its calls
// (CLAUDE.md), so every script ends with process.exit.
export function main(step: string, run: () => Promise<void>): void {
  run().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(`✗ ${step}: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}

/** --key value / --key=value / --flag arguments. Unknown keys are refused. */
export function parseArgs(argv: readonly string[], known: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]!);
    if (!m) throw new Error(`unexpected argument "${argv[i]}"`);
    const key = m[1]!;
    if (!known.includes(key)) throw new Error(`unknown option --${key} (known: ${known.map((k) => `--${k}`).join(", ")})`);
    const value = m[2] ?? (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true");
    out.set(key, value);
  }
  return out;
}

export function required(args: Map<string, string>, key: string): string {
  const v = args.get(key);
  if (v === undefined || v === "true") throw new Error(`--${key} is required`);
  return v;
}
