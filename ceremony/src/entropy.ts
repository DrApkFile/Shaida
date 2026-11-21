// Reads a contributor's entropy from the terminal without echoing it, so it never lands in shell history, a log
// or the record. snarkjs mixes it with 64 bytes from the OS RNG (misc.getRandomRng), so either source alone keeps
// the contribution secret. A dry run may pass CEREMONY_TEST_ENTROPY instead (refused in a real run).
import type { CeremonyPaths } from "./config.js";

export const MIN_ENTROPY_CHARS = 32;

function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error("entropy must be typed at a terminal (stdin is not a TTY)."));
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let text = "";
    const done = (err: Error | null) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (err) reject(err);
      else resolve(text);
    };
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\u0003") return done(new Error("cancelled (Ctrl-C); nothing was written."));
        if (ch === "\r" || ch === "\n") return done(null);
        if (ch === "\u007f") text = text.slice(0, -1);
        else text += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export async function readEntropy(paths: CeremonyPaths, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const test = env.CEREMONY_TEST_ENTROPY;
  if (test !== undefined) {
    if (!paths.dryRun) throw new Error("CEREMONY_TEST_ENTROPY is only allowed in a dry run (CEREMONY_DIR set). Unset it.");
    return test;
  }
  console.log(`Type at least ${MIN_ENTROPY_CHARS} random characters (mash the keyboard), then Enter. Nothing is shown or stored.`);
  const entropy = await readHidden("Entropy: ");
  if ([...entropy].length < MIN_ENTROPY_CHARS) throw new Error(`only ${[...entropy].length} characters; type at least ${MIN_ENTROPY_CHARS}. Nothing was written.`);
  return entropy;
}
