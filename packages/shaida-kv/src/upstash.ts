// KvClient over Upstash Redis (REST). Values are stored and read as plain strings (automaticDeserialization off), and
// every caller parses them with a strict schema. The client retries a failed HTTP request on its own, so every
// script here is written to give the same answer when it runs twice.
import { Redis } from "@upstash/redis";
import { KvReplyError, type KvClient, type KvScript, type SetOptions } from "./client";

export interface UpstashEnv {
  readonly url: string;
  readonly token: string;
}

/** The two env vars, or the names of the ones that are missing or malformed. */
export function upstashEnv(env: Readonly<Record<string, string | undefined>>): UpstashEnv | { readonly missing: readonly string[] } {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
  const missing: string[] = [];
  // http only to this machine (a local Redis behind serverless-redis-http, for measuring next start); never remote
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url);
  if (!/^https:\/\/[^\s/]+/.test(url) && !loopback) missing.push("UPSTASH_REDIS_REST_URL (an https:// URL)");
  if (token.length < 20) missing.push("UPSTASH_REDIS_REST_TOKEN");
  return missing.length ? { missing } : { url, token };
}

export function upstashKv(env: UpstashEnv, opts: { readonly allowHttp?: boolean } = {}): KvClient {
  if (!opts.allowHttp && !env.url.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.url)) throw new Error("kv: Upstash URL must be https");
  const redis = new Redis({ url: env.url, token: env.token, automaticDeserialization: false, enableTelemetry: false });
  return fromRedis(redis);
}

const asString = (what: string, v: unknown): string | null => {
  if (v === null || typeof v === "string") return v;
  throw new KvReplyError(what, v);
};

export function fromRedis(redis: Redis): KvClient {
  return {
    get: async (key) => asString(`GET ${key}`, await redis.get<string>(key)),
    mget: async (keys) => {
      if (keys.length === 0) return [];
      const out = await redis.mget<(string | null)[]>(...keys);
      if (!Array.isArray(out) || out.length !== keys.length) throw new KvReplyError("MGET", out);
      return out.map((v, i) => asString(`MGET ${keys[i]}`, v));
    },
    set: async (key: string, value: string, o: SetOptions = {}) => {
      const reply = o.nx
        ? await redis.set(key, value, o.pxMs !== undefined ? { nx: true, px: o.pxMs } : { nx: true })
        : await redis.set(key, value, o.pxMs !== undefined ? { px: o.pxMs } : undefined);
      if (reply === "OK") return true;
      if (reply === null && o.nx) return false;
      throw new KvReplyError(`SET ${key}`, reply);
    },
    smembers: async (key) => {
      const out = await redis.smembers<string[]>(key);
      if (!Array.isArray(out) || out.some((m) => typeof m !== "string")) throw new KvReplyError(`SMEMBERS ${key}`, out);
      return out;
    },
    run: async (script: KvScript, keys, args) => {
      const out = await redis.eval<string[], unknown>(script.lua, [...keys], [...args]);
      const n = typeof out === "number" ? out : typeof out === "string" && /^-?\d+$/.test(out) ? Number(out) : NaN;
      if (!Number.isInteger(n)) throw new KvReplyError(`EVAL ${script.name}`, out);
      return n;
    },
  };
}
