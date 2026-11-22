import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Server-side state for local dev (index cursor, relayer records; production uses Redis: state-store.ts). Never holds user secrets. Gitignored. */
export const dataDir = (): string => resolve(/*turbopackIgnore: true*/ process.env.SHAIDA_DATA_DIR?.trim() || join(process.cwd(), ".data"));

/** The parsed file, or null when it does not exist yet. Any other read error is thrown. */
export async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return JSON.parse(text);
}

/** Write to a temporary file and rename it over the old one, so a crash never leaves half a file. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), "utf8");
  await rename(tmp, path);
}

/** One async task at a time per key, inside this process. */
const tails = new Map<string, Promise<unknown>>();
export async function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const before = tails.get(key) ?? Promise.resolve();
  const run = before.then(task, task);
  tails.set(key, run.then(() => undefined, () => undefined));
  return run;
}
