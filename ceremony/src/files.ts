// File hashes. sha256 names every zkey (contributors check it with sha256sum / shasum -a 256); blake2b-512 is how
// the Hermez ptau is published.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { relative } from "node:path";
import { REPO } from "./config.js";

async function digest(file: string, algorithm: "sha256" | "blake2b512"): Promise<string> {
  const h = createHash(algorithm);
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export const sha256File = (file: string): Promise<string> => digest(file, "sha256");
export const blake2bFile = (file: string): Promise<string> => digest(file, "blake2b512");

/** A path as recorded: relative to the repo when inside it, else absolute (dry runs). */
export const recordedPath = (path: string): string => {
  const rel = relative(REPO, path);
  return rel.startsWith("..") ? path : rel;
};
