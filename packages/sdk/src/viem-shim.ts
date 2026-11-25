// The two viem helpers Shaida's engine uses (sha256, stringToBytes), over @noble/hashes, the library viem itself
// uses for them. scripts/build.mjs aliases "viem" to this file, so the bundle carries no viem transport code (which
// would pull Node-only ws into a browser build). Test S17 checks it against viem byte for byte.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export const stringToBytes = (value: string): Uint8Array => new TextEncoder().encode(value);
export const sha256 = (value: Uint8Array): `0x${string}` => `0x${bytesToHex(nobleSha256(value))}`;
