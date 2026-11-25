# shaida-sdk

Verify a [Shaida](https://github.com/DrApkFile/Shaida) income proof link in your own app, and optionally run an
underwriting policy on it. The SDK talks only to the Aevum testnet RPC (chain 44005, tUSD8). It doesn't use Shaida's
website or server.

A Shaida link proves "at least X tUSD8 received from N payments by registered payers, in a period". The recipient
makes it out to one named reader, and it carries an expiry. Verification is the full PRD §5 check: the strict link
schema, the asset, the bundle rules, the context opening, the reader and the expiry; then the ledger root on chain
and Groth16 with the ceremony's final key; and finally the period's dates from the ledger.

Status: 0.1.0, **verify side only**. The payer side (making vouched payments through ShaidaLedger) is not in this
package; see [ROADMAP](../../ROADMAP.md). Published on npm as [`shaida-sdk`](https://www.npmjs.com/package/shaida-sdk): `npm install shaida-sdk`. To use
it from this repository, run `pnpm --filter shaida-sdk tarball` and install the `shaida-sdk-0.1.0.tgz` it writes, or
depend on `packages/sdk` in a pnpm workspace.

## Quickstart

```js
import { verifyIncomeLink } from "shaida-sdk";

const v = await verifyIncomeLink(link, { readerName: "Landlord Bola", network: "aevum-testnet" });
if (v.status === "VALID") console.log(`at least ${Number(v.threshold) / 1e6} tUSD8 from ${v.count} payments`);
else console.log(v.status, v.code, v.message); // INVALID: refuse. INCONCLUSIVE: no answer yet, never a pass.
```

Node 20+ and modern browsers, ESM only, with full TypeScript types. Measured: Node 24.19 and 26.11 (the clean-install
test), and headless Chromium (the example page). Node 20 and 22 were not run here; the SDK needs only `fetch`,
`AbortSignal.timeout` and ES2022, which Node 20 has. A full verify on the public 44005 RPC took 15–22 s in the live
run. That time goes to dating the leaf range and the root with binary searches over past blocks, since the SDK keeps
no index; refusals that need no chain read return in milliseconds. The examples are
[examples/verify-node.mjs](../../examples/verify-node.mjs) (Node) and
[examples/rental-check/](../../examples/rental-check/) (a demo landlord page that runs in the browser).

## API reference

Every export is listed here. Test S13 fails if one is added or removed without updating this section. Amounts are
tUSD8 base units (6 decimals) as `bigint`. A link can be a full URL (`https://…/v#…`), `#…` or the bare fragment.

### `verifyIncomeLink(link, options): Promise<Verification>`

Runs the whole PRD §5 verification. `options` (`VerifyOptions`):

| Option | |
|---|---|
| `readerName` | Your name as the reader, exactly as the recipient made the link out (case and spacing are normalised). Required. |
| `network` | `"aevum-testnet"` (bundled, pinned). A `CustomNetwork` object is for local forks and test chains; chain 44005 is refused there. Required. |
| `rpcUrl` | The JSON-RPC endpoint you trust. Default for `"aevum-testnet"`: `https://rpc-test.qday.info`. A custom network needs one. |
| `timeoutMs` | Per RPC call. Default 15 000. |
| `now` | `() => bigint` unix seconds. Default: the system clock. |

It returns one of three shapes:
- `VALID`: `{ threshold, count, from, to, expiry, proofs, leafRange, ledgerRoot, network, block }`. `from` and `to`
  are the block times of the first and last vouched payment counted. `block` is the block every chain read was
  pinned to.
- `INVALID`: `{ code, message, nextAction }`. This is a final answer about the link: refuse it.
- `INCONCLUSIVE`: `{ code, message, nextAction }`. There is no answer yet. Never treat it as a pass.

A link refused on its own content (malformed, edited, wrong reader, expired) makes no RPC call at all.

### `decodeIncomeLink(link): Decoded`

Pure, with no network. It returns `{ ok: true, link }` with each proof's public signals (`threshold`, `count`,
`fromIndex`, `toIndex`, `ledgerRoot`, `asset`, `context`) and the link's `expiry`. Otherwise it returns
`{ ok: false, code: "ProofInvalid", message }`. **Unverified**: use it for display only.

### `checkOnChain(link, options): Promise<OnChainCheck>`

Calls `IncomeVerifier.check(proof, signals)` for each proof, as an `eth_call` with `CHECK_GAS` gas at the latest
block. It is a view call, so nothing is sent. The contract checks the asset, that the root is known, and Groth16.
It does **not** check the reader, the expiry, the bundle rules or the dates; `verifyIncomeLink` checks all of them.
The result is one of:
- `ACCEPTED { proofs, block }`;
- `REJECTED { proof, code, message, block }`, where `code` is `ProofInvalid`, `AssetMismatch` or `UnknownRoot` and
  `proof` is null for a malformed link;
- `INCONCLUSIVE { code: ChainUnreachable | NotConfigured }`.

`options` is `ReadOptions`, which is `network`, `rpcUrl` and `timeoutMs`.

### `CHECK_GAS`

`400000n`. snarkjs verifiers return `false` when short of gas instead of reverting, so an estimate is not enough.
The contract also refuses below its own minimum.

### `underwrite(link, policy, options): Promise<Decision>`

The same deterministic engine as Shaida's underwriting bot, run in your process with no LLM. It runs PRD §5 for the
policy's reader, then the policy's six rules in a fixed order. The result is one of:
- `APPROVE { facts }`;
- `DECLINE { reasons[], facts | null }`, which lists every rule that fails, or the single link refusal;
- `INCONCLUSIVE { error }`, with `ChainUnreachable`, `UnknownRoot` or `RangeUnresolvable`.

Every decision carries `decisionId`, `proofId`, `policy {id, version, hash, title}` and `evaluatedAt`. The same link
under the same policy gives the same `decisionId` while no time limit is crossed. `options` is `UnderwriteOptions`:
`ReadOptions` plus `now`. A bad setup (failed pins, an unknown network, an RPC on another chain) throws
`ShaidaConfigError` instead of returning a decision.

### `definePolicy(input): { ok: true, policy } | { ok: false, code: "InputRejected", message }`

Builds your own policy (your reader name, your limits) and validates it strictly. It never throws. `input` is a
`PolicyInput`:
- `id`, `version`, `title`, and `audience` (`landlord`, `lender` or `donor`);
- `readerName`;
- `minThreshold`: base units as a decimal string;
- `minPayments`;
- `minPeriodDays` and `maxPeriodDays`;
- `maxProofAgeDays`;
- `minDaysLeft`.

The policy's `hash` covers all of them, so a silent edit shows in every decision.

```js
const kora = definePolicy({ id: "kora-rent-check", version: 1, title: "Kora rent check", audience: "landlord",
  readerName: "Kora Rentals", minThreshold: "1000000", minPayments: 2, minPeriodDays: 1, maxPeriodDays: 92,
  maxProofAgeDays: 30, minDaysLeft: 7 });
if (kora.ok) console.log((await underwrite(link, kora.policy, { network: "aevum-testnet" })).kind);
```

### `RENT_CHECK`

The `rent-check@1` preset: at least 1 tUSD8 from 2 or more payments, over 1 to 92 days. The proof must be at most
30 days old and the link valid for at least 7 more days. Its reader is `Shaida underwriting bot (demo)`, the live
bot's, so it only approves links made out to that bot. Use `definePolicy` for your own reader name.

### `REVENUE_CREDIT`

The `revenue-credit@1` preset: at least 10 tUSD8 from 6 or more payments, over 28 to 184 days. The proof must be at
most 14 days old and the link valid for at least 14 more days. It uses the same reader as `RENT_CHECK`.

### `ShaidaConfigError`

Thrown by `underwrite` only, never for a fact about the link. Its `code` is `"NotConfigured"`.

### `AEVUM_TESTNET`

The bundled network, frozen:
- `chainId` 44005;
- `rpcUrl`;
- `asset`: tUSD8 `0x4565…3483`;
- `ledger`: ShaidaLedger `0x677659b0…88ed`;
- `incomeVerifier`: `0xc9844a8f…c1c8`;
- `fromBlock`: 3810988, the ledger's deploy block.

All of these come from `deployments/aevum.json`.

### `PINNED`

`{ vkeySha256, networkSha256 }`: the sha256 values of the canonical JSON of the bundled verification key and
network. Every call checks both before it reads anything. A patched bundle or a swapped key gives `NotConfigured`.

### `CODES`

Every code below, as `{ outcome, meaning, nextAction }`, ready to render.

### Types

| Type | |
|---|---|
| `Verification` | `Valid \| Refused<"INVALID", InvalidCode> \| Refused<"INCONCLUSIVE", InconclusiveCode>` |
| `Valid` | The VALID shape above |
| `Refused` | `{ status, code, message, nextAction }` |
| `VerifyCode` | `InvalidCode \| InconclusiveCode` |
| `InvalidCode` | The INVALID codes below |
| `InconclusiveCode` | The INCONCLUSIVE codes below |
| `Decoded` | The result of `decodeIncomeLink` |
| `DecodedLink` | A decoded, unverified payload |
| `OnChainCheck` | The result of `checkOnChain` |
| `Decision` | The result of `underwrite` |
| `DecisionFacts` | A decision's facts, as decimal strings (base units, unix seconds) |
| `DeclineCode` | `InvalidCode \| RuleCode` |
| `RuleCode` | The six policy rules |
| `ShaidaErrorInfo` | `{ code, message, retryable, nextAction }` in an INCONCLUSIVE decision |
| `Policy` | A validated policy (from `definePolicy` or a preset) |
| `PolicyInput` | What `definePolicy` takes |
| `ReadOptions` | `{ network, rpcUrl?, timeoutMs? }` |
| `VerifyOptions` | `ReadOptions` and `{ readerName, now? }` |
| `UnderwriteOptions` | `ReadOptions` and `{ now? }` |
| `NetworkConfig` | The shape of `AEVUM_TESTNET` |
| `CustomNetwork` | `{ name, chainId, ledger, incomeVerifier, fromBlock }` for a local fork |
| `CodeInfo` | `{ outcome, meaning, nextAction }` |

## Codes

This list is closed: test S14 checks this table against `CODES`. INVALID means refuse. INCONCLUSIVE means no answer
yet: try again or fix the setup, never approve. DECLINE codes come only from `underwrite`, which also declines with
any INVALID code.

| Code | Outcome | What it means |
|---|---|---|
| `ProofInvalid` | INVALID | The link is malformed or edited (a public number changed, so Groth16 refuses), or it is not a Shaida proof. |
| `AssetMismatch` | INVALID | The proof is not about tUSD8. |
| `MixedContexts` | INVALID | The link joins proofs made for different readers or expiry dates. |
| `MixedRoots` | INVALID | The link joins proofs built against different ledger states. |
| `RangesOverlap` | INVALID | Two proofs cover the same ledger leaves, so a payment could count twice. |
| `ContextMismatch` | INVALID | The link's reader, expiry or salt do not match its proofs: it was altered. |
| `WrongReader` | INVALID | The link was made for another reader. |
| `ProofExpired` | INVALID | The link has expired. |
| `UnknownRoot` | INCONCLUSIVE | The proof's ledger root is not known at the pinned block: a stale RPC, the wrong network, or a forged root. |
| `RangeUnresolvable` | INCONCLUSIVE | The leaf range could not be dated from the chain yet. |
| `ChainUnreachable` | INCONCLUSIVE | The RPC is down, timed out, or refused the call. |
| `NotConfigured` | INCONCLUSIVE | The SDK refused its own setup: a pin mismatch, an unknown or invalid network, or an RPC on another chain. |
| `InputRejected` | INCONCLUSIVE | The reader name is empty or longer than 96 bytes. |
| `BelowMinThreshold` | DECLINE | The proof shows less income than the policy needs. |
| `TooFewPayments` | DECLINE | The proof counts fewer payments than the policy needs. |
| `PeriodTooShort` | DECLINE | The proof covers fewer days of the ledger than the policy needs. |
| `PeriodTooLong` | DECLINE | The proof spreads its total over more days than the policy allows. |
| `ProofTooOld` | DECLINE | The ledger state the proof was built on is older than the policy allows. |
| `ExpiresTooSoon` | DECLINE | The link expires sooner than the policy needs. |

## Trust model

**What VALID guarantees.** It means all of the following hold:
- Every proof in the link verifies under the income circuit's **final** ceremony key, which is pinned by hash.
- The proofs share one ledger root, which ShaidaLedger on chain 44005 knows at `block`.
- The proofs count disjoint leaf ranges, so no payment is counted twice.
- The link was made out to `readerName` and has not expired at `now`.

Given those, the recipient received at least `threshold` tUSD8 in at least `count` payments, through Shaida's
ledger. Each payment was vouched by a payer that was **registered and active** when it paid, and swept by the
recipient. `from` and `to` are the chain's own block times. VALID does not say who the recipient is, which payers
paid, or what each payment was.

**The reader name binds intent, not identity.** The reader name is a commitment inside the proof: a link made for
"Landlord Bola" fails for anyone who types another name. Nothing authenticates that the person verifying is Bola.
Anyone holding the link who types "Landlord Bola" gets VALID. Treat a link as a document the applicant handed to
you, not as a credential that proves who you are.

**Expiry.** The recipient picks it when making the link, and it is bound into the proof: editing it gives
`ContextMismatch`. After it, the link is `ProofExpired`. `underwrite` adds the policy's own floors
(`minDaysLeft`, `maxProofAgeDays`).

**Which RPC you trust.** Every chain fact comes from the RPC you pass, or from the bundled
`https://rpc-test.qday.info`: the chain id, the root's status, and the leaf dates. A dishonest RPC could claim a
forged root is known. Groth16 still has to verify against that root, but the root-on-chain step is only as good as
the RPC. Use an endpoint you trust, or run your own node, for anything that matters. The SDK checks that the RPC
serves the network you asked for (otherwise `NotConfigured`), and it pins every read to one block.

**What a verifier learns.** This summarises Shaida's privacy audit ([LIMITS.md](../../LIMITS.md),
[evidence/privacy-audit.md](../../evidence/privacy-audit.md), D32).

From the link itself, a verifier learns:
- the proven minimum and the payment count;
- the leaf range and its dates;
- the expiry and the ledger root.

The recipient's address, the individual amounts and the recipient's other payments are not in the link. But the
leaf range points at public ledger leaves, and anyone with an RPC can already see these from the chain:
- **which registered payer made each payment** (the `Vouched` event carries the payer id; not hidden, by design);
- each payer's deposits, which cap what that payer paid;
- the amount of any swept note that was withdrawn whole;
- the timing that ties sweeps to payments.

With one active payer and few users, "at least X" can therefore narrow to "exactly X" for an observer who joins the
link to the chain. Treat a link as revealing the payer side of the range.

The SDK itself sends nothing anywhere except the RPC calls listed above: no telemetry, no Shaida server, and no
secrets (it holds none).

## Who integrates Shaida

Shaida is built to be integrated: the verify side needs one npm package and an RPC. There are no users yet; these
are the integrations it is designed for.
- **Rental platforms**: check an applicant's income before a viewing, without bank statements
  ([examples/rental-check](../../examples/rental-check/)).
- **Lenders and BNPL**: size a credit line from proven revenue (`REVENUE_CREDIT`, or your own `definePolicy`).
- **Freelance marketplaces**: show "earned at least X here in the last 90 days" badges, without exposing clients.
- **Visa consultancies**: an income floor for a period, as a document that can't be edited.
- **DAO grant programs**: confirm a contributor's track record of paid work before a grant.
- **AI agents**: verify a link in-process, or call the bot's `/api/underwrite` (see `/llms.txt`), with no LLM in
  the decision.
- **Payroll and payout platforms**: the **payer side**, which pays contractors through ShaidaLedger so they can
  prove income later. It is not in this package yet (ROADMAP).

## Licences

This is a statement of facts, not legal advice. The licences below were measured on 2026-11-25 by installing the
tarball into a clean project (see [NOTICE.md](NOTICE.md) for the full list).
- **shaida-sdk is MIT.** `dist/index.js` inlines Shaida's own MIT code (`packages/shaida-proofs`, the underwriting
  engine, the policy presets and the final verification key as data) and small parts of `viem` and `@noble/hashes`
  (both MIT, for sha256). `build-inputs.json` lists exactly what was inlined. The build refuses to inline snarkjs or
  any other GPL package.
- **Dependencies installed next to it:**
  - `snarkjs` 0.7.6 and `ffjavascript` 0.3.1 are **GPL-3.0**, and so are several of their own dependencies.
  - `zod` 3.25.76 and `poseidon-lite` 0.3.0 are MIT.
- **What an integrator inherits.**
  - Using the SDK from a server, or installing it as an npm dependency, does not put your code under the GPL.
    GPL-3.0 (unlike AGPL) attaches no conditions to network use.
  - If you **distribute** a build that contains snarkjs or ffjavascript, you convey GPL-3.0 code and must meet
    GPL-3.0's terms for that code: the licence text, and the corresponding source or an offer of it. Distributing
    includes a browser bundle, a desktop app or a container image you ship. Whether GPL-3.0 then reaches your own
    code depends on how the work is combined; that is a question for your lawyer.
  - The MIT notice of this package must be kept in copies of it.
- **The verification key** is data that snarkjs generated from Shaida's income circuit, which uses circomlib
  (GPL-3.0) templates. The key contains no circomlib source code.
