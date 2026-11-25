# Shaida

Income proofs on Aevum Testnet (chain 44005, tUSD8): get paid through a shielded pool, then prove to a reader you name
(a name, not a login: CL36) that you received at least a threshold from registered payers. The proof shows more than
the threshold: who paid and when, and with public chain data often the exact total. Measured on the live deployment,
see [Privacy](#privacy-what-is-hidden-and-what-is-not). <!-- CL30 --> <!-- CL32 -->

**Live app: https://shaida.onrender.com** (Aevum testnet 44005; no login needed to open the example proof). Checked
logged out in [evidence/hosting-render.md](evidence/hosting-render.md). <!-- CL43 -->

Based in part on the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs).
Private payments run on [Gloam](https://github.com/gloamtrade/gloam) (MIT), a pinned submodule. See [NOTICE.md](NOTICE.md). <!-- CL01 -->

## Status
Every statement here maps to a row in [CLAIMS.md](CLAIMS.md); `make gate` fails if one is not PROVEN.
<!-- CL24 -->

PRD §11 steps 1–2 and acts 2–6 run on a local fork <!-- CL02 --> <!-- CL35 -->. The stack is deployed on Aevum testnet and checked
against the chain ([deployments/aevum.json](deployments/aevum.json), [evidence/aevum-deployment.md](evidence/aevum-deployment.md)) <!-- CL03 -->;
14 of its 16 contracts are verified on the explorer (links below) <!-- CL39 -->. Acts 2–6 ran twice on 44005 with demo
personas. Run 1, driven by script: three vouched payments of 1.5 + 1 + 0.5 tUSD8, swept, proved ≥ 3 tUSD8 with the final key, VALID for
"Landlord Bola", checked and attested on chain ([evidence/live-44005-run1.md](evidence/live-44005-run1.md), every tx
linked) <!-- CL31 --> <!-- CL33 -->. The landing page's example link is that run's proof.
Run 2 was clicked by hand on the live site in Firefox (Ada and Acme at 390 px): a gasless deposit, three vouched payments of
0.5 + 0.3 + 0.2 tUSD8, one sweep of all three, a ≥ 1 tUSD8 proof built in the browser in 16.2 s, VALID, checked and
attested on chain ([evidence/live-44005-run2.md](evidence/live-44005-run2.md)) <!-- CL33 -->.
- Contracts: `PayerRegistry` <!-- CL04 -->, `ShaidaDepositor` (gasless EIP-3009 + standard deposit) <!-- CL05 -->,
  `ShaidaLedger` (vouch and sweep leaves, one vouch per payment, `lateVouch` repair for a front-run pay: DECISIONS D9)
  <!-- CL06 -->, on Gloam's pool with its final-ceremony verifiers. <!-- CL07 -->
- Income circuit (`packages/shaida-proofs`): 4 slots per proof, 44,687 constraints (DECISIONS D12). <!-- CL08 --> A pure
  witness builder splits a period into a bundle of up to 8 proofs over disjoint leaf ranges <!-- CL09 -->, and the pure
  verification core (PRD §5) checks bundles. <!-- CL10 --> Tested with honest cases, the circuit cheats of EVAL_DESIGN
  (X04–X09 and public-signal tampering), the bundle refusals (X14–X18) and property tests. <!-- CL11 --> Each proof's
  threshold share is rounded down to whole tUSD8 (D13). <!-- CL12 -->
  Circuit tests and timings use a **throwaway local key**. <!-- CL13 -->
- Ceremony (step 3): done. Contributions by Kene and Gunroar and a beacon from Aevum block 3772100, verified; final
  zkey sha256 `cbcb06fe…` ([ceremony/TRANSCRIPT.md](ceremony/TRANSCRIPT.md)) <!-- CL14 -->, published as the release
  [`ceremony-v1`](https://github.com/DrApkFile/Shaida/releases/tag/ceremony-v1), whose asset hashes as recorded
  ([evidence/ceremony-release.md](evidence/ceremony-release.md)). <!-- CL34 --> The throwaway key (`NEXT_PUBLIC_SHAIDA_INCOME_KEY=throwaway`) works on local chains only and is refused
  on Aevum 44005 (D21). <!-- CL15 -->
- `IncomeVerifier` (on-chain check of one proof: tUSD8, known ledger root, gas guard, Groth16; optional attest):
  unit-tested with a placeholder and two throwaway verifiers; over the ceremony's verifier it is part of the fork
  deploy, which refuses a verifier that rejects a final-key proof or accepts a throwaway-key one (D24). <!-- CL16 -->
  Deployed on Aevum testnet with the ceremony's verifier, which accepts a final-key proof there. <!-- CL03 -->
- Tests: `make test` (contracts, circuit, witness builder) and `make test-fork` (real tUSD8 on a fork, including
  deposit → vouched pay → sweep with real proofs). Gas: [evidence/fork-gas.md](evidence/fork-gas.md). <!-- CL17 -->
  Issuer and front-running limits: [LIMITS.md](LIMITS.md). <!-- CL18 -->
- Indexer (`packages/shaida-index`, `/api/index`): pool and ledger leaf snapshots from chunked `eth_getLogs` (≤ 999
  blocks a page, retry with backoff, persisted cursor, reads pinned to one block); the browser recomputes both roots
  and checks `isKnownRoot` on chain, refusing with `UnknownRoot`. <!-- CL19 -->
- Relayer (`packages/shaida-relay`, `/api/relay/<fn>`): one route per contract function (deposit, vouched-pay,
  late-vouch, sweep, memo), rails before simulation, a daily gas budget, persisted records, unknown outcomes never
  resent (D19, D20). <!-- CL20 -->
- Pay and inbox (`/app/pay`, `/app/inbox`, `packages/shaida-pay`): gasless deposit, vouched private pay with a sealed memo,
  inbox and sweep <!-- CL21 -->, proofs made in the browser with Gloam's final keys <!-- CL22 -->, secrets in an
  encrypted browser vault whose exported backup restores in a fresh browser (D21). <!-- CL23 -->
- PRD §11 acts 2–3 on the fork: [evidence/acts-2-3-fork.md](evidence/acts-2-3-fork.md) (script, tx hashes) and
  [evidence/ui-fork/](evidence/ui-fork/report.md) (the same flow through the UI at 390 px). <!-- CL02 --> <!-- CL21 -->

- Income proofs (`/app/prove`, `/app/shared`, `/v`): a proof link made in the browser with the ceremony's final key,
  for a reader name that binds intent, not identity (anyone with the link who types the name sees VALID). <!-- CL36 -->
  PRD §11 acts 4–6 on the fork: [evidence/acts-4-6-fork.md](evidence/acts-4-6-fork.md) (script) <!-- CL35 --> and
  [evidence/ui/](evidence/ui/report-390.md) (the same acts through the UI at 390 and 1280 px, with the browser's proving
  time and screenshots). <!-- CL37 -->
- Withdrawals (`/app/withdraw`, relayer route `unshield`): swept notes leave the pool in one batch, to an address the
  recipient picks. They are public and reveal their amounts, so they are never automatic (LIMITS.md, D28). <!-- CL40 -->
- Web: a landing page `/` and a dashboard `/app` in a design system taken from Muuve's style ([DESIGN.md](DESIGN.md),
  D25, D26). <!-- CL38 -->

- Withdrawal on Aevum testnet: run 1's 3 swept notes were withdrawn in one batch through the live site's
  `/app/withdraw` and relayer, driven by a headless browser script (not by hand), then forwarded to the deployer
  ([evidence/budget.md](evidence/budget.md), [evidence/ui-44005/](evidence/ui-44005/report-withdraw-390.md)). <!-- CL40 -->

- Hosting: https://shaida.onrender.com on Render free with Upstash Redis (D29, [DEPLOY_RENDER.md](DEPLOY_RENDER.md)),
  checked logged out: health, pinned proving files, relayer, index, and the example link VALID at 390 px
  ([evidence/hosting-render.md](evidence/hosting-render.md)). <!-- CL43 -->

- Underwriting bot (`/underwrite`, `POST /api/underwrite`, CLI; `packages/shaida-underwrite`, D30): checks a proof
  link made out to it against a versioned policy (presets `rent-check` and `revenue-credit`) and answers APPROVE,
  DECLINE with every failing reason, or INCONCLUSIVE; deterministic, no LLM, never an approval on an unreadable chain;
  every rule is load-bearing and a 2,000-case property test holds. <!-- CL44 --> Rate-limited, size-capped, no link in its
  logs; recording an approval on chain is off by default and, when on, uses its own capped key, once per proof
  (THREAT_MODEL.md). <!-- CL45 --> Templates for merchants and grantees and the bot's page, in the browser at 390 px
  ([evidence/underwrite-ui/](evidence/underwrite-ui/report-390.md)). <!-- CL46 --> On the live site, a proof Ada (demo) made for the bot
  was approved under rent-check and declined under revenue-credit, with the same decision ids from the local CLI
  ([evidence/underwrite-live-44005.md](evidence/underwrite-live-44005.md)). <!-- CL47 --> The bot then recorded that approval on
  chain with its own key, one attest of 267,053 gas. <!-- CL48 -->

Secrets: `make gate` scans the git history with gitleaks; keys and keystores are gitignored. <!-- CL41 -->

## Privacy: what is hidden and what is not
Measured by attacking the live deployment (every 44005 transaction to block 3961095) and a fork fixture with known
ground truth: [evidence/privacy-audit.md](evidence/privacy-audit.md), tools `tools/privacy-observer.mjs` and
`tools/privacy-reader.mjs`, plain-words list in [LIMITS.md](LIMITS.md). Proposed fixes (none applied): DECISIONS D32.

| | Anyone with the explorer (CL32) | A reader holding the link (CL30) |
|---|---|---|
| Which payer paid | **learns it** (payer id, address and signature in every pay, 6 of 6) | **learns it** (payer ids in the range) |
| Total received | **learns it** when deposits and on-chain attests pin it (4 tUSD8 exactly on 44005) | **learns it** with the same chain data (3, 1, 1 tUSD8 exactly) |
| Each payment's amount | **learns it** if the swept note is withdrawn (3 of 3); otherwise only a bound | only a bound |
| Which sweep is whose payment | by timing today (6 of 6); hidden by the nullifier, not by volume | the times of every payment and sweep in the range |
| Receive address paid | not learned (sealed memos show only a fixed header) | not learned |
| Amount from gas | not learned (≤ 60 gas apart across amounts) | — |

Today the pool has one payer and one recipient, so several "not learned" rows hold only because nothing else happens
in it. Recording a check on chain (`attest`) publishes the proof's threshold, count and range to everyone.
<!-- CL30 --> <!-- CL32 -->

## Who it's for
- **Freelancers** show a landlord they earn enough for the rent. On `/app/prove`, pick "Income, for a landlord".
- **Merchants** show a lender revenue over a quarter without showing which customers paid: "Revenue proof, for a
  lender". The reader's page says "customer payments", and points a lender at the bot's `revenue-credit` policy.
- **Grantees** show a donor or sponsor the disbursements they received: "Disbursements, for a donor or sponsor".
- **Landlords and lenders** who read many links can use the underwriting bot instead of reading each one.

Templates change wording and a suggested reader only; the proof and its VALID facts are the same (D31, LIMITS.md).

## For agents
The underwriting bot is an API with a published contract, made to be called by software:
- `GET /llms.txt`: what Shaida is and how to call the bot, in plain text.
- `GET /.well-known/agent.json`: the agent card: request and response schemas, presets with their limits and policy
  hashes, the closed decision and error codes, the rate limit, and whether on-chain recording is on.
- `POST /api/underwrite` with `{"link": "<proof link>", "preset": "rent-check", "record": false}` returns the decision.
  The same link and policy version give the same decision and `decisionId`.
- The bot is deterministic (no LLM) and sees only the link it is sent: the proof's public facts (amount floor, payment
  count, ledger range, expiry). Like any reader, it can also read the chain, and so the payer id and time of each
  payment in the range (CL30). It does not see single payment amounts or the holder's address. A link made out to
  another reader is declined (`WrongReader`). To keep the link off any server, run the CLI:
  `pnpm --filter @shaida/underwrite decide --preset rent-check --link '<link>'`.
- In real use, a lender would run the bot themselves (the CLI, or their own deployment of this code with their own
  policy file and reader name), so their applicants' proofs never touch Shaida's server. The hosted bot is a demo.

## Aevum testnet contracts (chain 44005)
Deployed from commit `2a10759`; checked against the chain in [evidence/aevum-deployment.md](evidence/aevum-deployment.md),
which lists all 16 addresses with each verified source's SPDX line. <!-- CL03 --> <!-- CL39 -->

| Contract | Address | Explorer |
|---|---|---|
| ShieldPoolPoseidon (Gloam) | [`0x0d93a398de615c92b04961dd042471fea4b7eac6`](https://explorer-test.qday.info/address/0x0d93a398de615c92b04961dd042471fea4b7eac6?tab=contract) | verified |
| ShaidaLedger | [`0x677659b068278103f83eff413080cb53be3388ed`](https://explorer-test.qday.info/address/0x677659b068278103f83eff413080cb53be3388ed?tab=contract) | verified |
| ShaidaDepositor | [`0x6a6045a64ae911744fcd63b3186277f8958db2ec`](https://explorer-test.qday.info/address/0x6a6045a64ae911744fcd63b3186277f8958db2ec?tab=contract) | verified |
| PayerRegistry | [`0xce43b77adc82db336d07f03bd84c3834fd9c5215`](https://explorer-test.qday.info/address/0xce43b77adc82db336d07f03bd84c3834fd9c5215?tab=contract) | verified |
| GloamPayMemo (Gloam) | [`0xe2f7c6310e5ccb87fde4ff887b100236960c4e17`](https://explorer-test.qday.info/address/0xe2f7c6310e5ccb87fde4ff887b100236960c4e17?tab=contract) | verified |
| IncomeVerifier | [`0xc9844a8f058be2d658c972d1d2276b13f308e1c8`](https://explorer-test.qday.info/address/0xc9844a8f058be2d658c972d1d2276b13f308e1c8?tab=contract) | verified |
| IncomeGroth16Verifier | [`0xbb79e350e0c27b97f6512173ec7e4dd82bf632af`](https://explorer-test.qday.info/address/0xbb79e350e0c27b97f6512173ec7e4dd82bf632af?tab=contract) | verified |
| DualProofVerifier (Gloam) | [`0xd791178ec6a80ac2fcfeb2a236c427d5a818b57c`](https://explorer-test.qday.info/address/0xd791178ec6a80ac2fcfeb2a236c427d5a818b57c?tab=contract) | verified |
| ShieldVerifierFinal / ShieldIVerifierFinal (Gloam) | [`0x6c15d7cc7f05d8fb8fceab9bd7e92c753abe13e7`](https://explorer-test.qday.info/address/0x6c15d7cc7f05d8fb8fceab9bd7e92c753abe13e7?tab=contract) | verified (adapter `0x6f82…b446` too) |
| UnshieldVerifierFinal / UnshieldIVerifierFinal (Gloam) | [`0xa25b573404fe423aeb005c9539c79d806199a1f5`](https://explorer-test.qday.info/address/0xa25b573404fe423aeb005c9539c79d806199a1f5?tab=contract) | verified (adapter `0xa63d…e843` too) |
| TransferVerifierFinal / TransferIVerifierFinal (Gloam) | [`0xf220726b8f177e7347d6b58f0b14b2380a572cda`](https://explorer-test.qday.info/address/0xf220726b8f177e7347d6b58f0b14b2380a572cda?tab=contract) | verified (adapter `0xfe33…5708` too) |
| PoseidonT3 / PoseidonT4 | [`0x1e771073ac7703772c3717650ca0577e103dfaaf`](https://explorer-test.qday.info/address/0x1e771073ac7703772c3717650ca0577e103dfaaf?tab=contract) | bytecode only (circomlibjs, no source); T4 `0xc7aa…ec69` |

## Commands
```bash
make install      # submodules + pnpm
make build        # forge build + Shanghai opcode check (ours and Gloam's) + income circuit compile (circom 2.2.3)
make test         # unit tests: contracts, circuit, witness builder, indexer, relayer, pay flows, ceremony
make gate         # BUILD_CONTRACT gate in a fresh clone of HEAD (GATE_IN_PLACE=1 to run in this tree)
make test-groth16 PTAU_PATH=<Hermez 2^17 ptau>   # full Groth16 proofs with a throwaway local key (local only)
make bench-circuit PTAU_PATH=<…>                 # writes evidence/income-circuit.md
make test-fork    # tests against the real tUSD8 (needs https://rpc-test.qday.info)
make fork         # local Aevum fork, chain 440050 on 127.0.0.1:8555
make deploy-fork  # deploy the stack to the fork; writes deployments/fork.json
make deploy-aevum ACCOUNT=<keystore> ATTESTOR=0x...   # real deploy (clean committed tree only); writes deployments/aevum.json
make verify-aevum # read-only: check deployments/aevum.json against the chain and the explorer; writes evidence/aevum-deployment.md
make secrets      # gitleaks over the git history and uncommitted changes (.gitleaks.toml; also gate step 8)
pnpm --filter @shaida/gloam-fixtures gen:fork-flow    # regenerate the fork test's Gloam proofs (final keys)
```
