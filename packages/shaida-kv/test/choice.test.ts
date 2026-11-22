import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StoreNotConfigured, chooseStore } from "../src/index";

const up = { UPSTASH_REDIS_REST_URL: "https://eu1-example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "AX_example_token_0123456789" };

describe("store choice at startup", () => {
  it("KV01 production with no Redis env is refused by name, naming both variables", () => {
    assert.throws(() => chooseStore({ NODE_ENV: "production" }), (e: unknown) => {
      assert.ok(e instanceof StoreNotConfigured);
      assert.match(e.message, /^StoreNotConfigured: .*UPSTASH_REDIS_REST_URL.*UPSTASH_REDIS_REST_TOKEN/);
      return true;
    });
  });

  it("KV01 production with one variable missing or a non-https URL is refused, and the token never appears in the message", () => {
    assert.throws(() => chooseStore({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: up.UPSTASH_REDIS_REST_URL }), /UPSTASH_REDIS_REST_TOKEN is not set/);
    assert.throws(() => chooseStore({ NODE_ENV: "production", ...up, UPSTASH_REDIS_REST_URL: "http://plain.example" }), (e: unknown) => {
      assert.ok(e instanceof StoreNotConfigured);
      assert.match(e.message, /https/);
      assert.doesNotMatch(e.message, /AX_example_token/);
      return true;
    });
  });

  it("KV02 production with both variables chooses Redis", () => {
    const c = chooseStore({ NODE_ENV: "production", ...up });
    assert.equal(c.kind, "redis");
  });

  it("KV03 the file store is chosen only for dev or by SHAIDA_STORE=file, and refused on Render", () => {
    assert.equal(chooseStore({ NODE_ENV: "development" }).kind, "file");
    assert.equal(chooseStore({ NODE_ENV: "production", SHAIDA_STORE: "file" }).kind, "file", "explicit, for a local next start");
    assert.throws(() => chooseStore({ NODE_ENV: "production", SHAIDA_STORE: "file", RENDER: "true" }), /StoreNotConfigured: SHAIDA_STORE=file on Render/);
    assert.throws(() => chooseStore({ NODE_ENV: "development", RENDER: "true" }), /on Render/);
  });

  it("KV04 SHAIDA_STORE=redis in dev still needs both variables; any other value is refused", () => {
    assert.throws(() => chooseStore({ NODE_ENV: "development", SHAIDA_STORE: "redis" }), StoreNotConfigured);
    assert.equal(chooseStore({ NODE_ENV: "development", SHAIDA_STORE: "redis", ...up }).kind, "redis");
    assert.throws(() => chooseStore({ SHAIDA_STORE: "memory" }), /must be "redis" or "file"/);
  });

  it("KV05 plain http is accepted only to this machine (a local Redis for measuring), never to a remote host", () => {
    assert.equal(chooseStore({ NODE_ENV: "production", ...up, UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079" }).kind, "redis");
    assert.throws(() => chooseStore({ NODE_ENV: "production", ...up, UPSTASH_REDIS_REST_URL: "http://127.0.0.1.evil.example" }), StoreNotConfigured);
    assert.throws(() => chooseStore({ NODE_ENV: "production", ...up, UPSTASH_REDIS_REST_URL: "http://localhost@evil.example" }), StoreNotConfigured);
  });
});
