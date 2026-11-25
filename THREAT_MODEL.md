# Threat model

PRD §8 is the security model for the contracts, the circuit, the relayer and the browser vault. This file adds what
the underwriting bot (D30) brings: a public decision endpoint and a key of its own; and what revocation (D35) and
reader codes (D36) bring. Each threat names its control and the test or evidence that shows it.

## The bot's key (recording on chain)

| Threat | Control | Shown by |
|---|---|---|
| The bot's key is used for something else, or a leak lets it move value | A dedicated key, required only when `UNDERWRITE_RECORD=on`; the server refuses to start if it equals the relayer's key. It signs only legacy txs to the deployment's IncomeVerifier with the `attest` selector, 420,000 gas, value 0. It is funded with tQDAY for a few attests and holds no tUSD8. | `test:U24b` `test:U21c` |
| Recording is switched on by accident | Off unless the variable is exactly `on`; any other value stops the server at startup. | `test:U24` `test:U24b` |
| An attacker drains the key's gas with many approvals | Daily caps on count (default 3) and reserved gas (default 1,260,000), claimed atomically in KV before signing; a bundle that would cross a cap is refused whole; the rate limit applies first. Worst case per day is the cap × 420,000 gas × 1 gwei. | `test:U15` `test:U15b` |
| The same proof recorded twice (spam or a retry) | One record per proof hash, ever, under any policy or version; a repeat returns the first record. | `test:U14` |
| A crash or a lost answer resends a tx | The record (hash, nonce) is persisted before the send; a send with no answer stays `unknown` and a refused one `dropped`, and neither is sent again. One recording at a time (in-process queue and a KV lease lock). | `test:U22` `test:U22b` `test:U25` |
| A declined or unchecked proof gets recorded | Only an APPROVE is recorded, and `IncomeVerifier.check` must pass first. | `test:U21b` `test:U21d` |
| The key leaks from logs | The key is read from the environment once and never logged; only its address is shown (page, agent card). | `web/src/server/underwrite.ts` |

## The endpoint (`POST /api/underwrite`)

| Threat | Control | Shown by |
|---|---|---|
| Flooding (CPU for Groth16, RPC reads) | 10 decisions a minute per client IP in the shared store, checked before the body is read; Groth16 on one thread (44 ms measured); malformed links are declined before any chain read. | `test:U19` `test:U12e` |
| Oversized or malformed bodies | 16 KiB cap (413), strict JSON schema (unknown fields refused), link ≤ 12,000 characters, preset must exist. | `test:U19b` |
| Links leaking through logs | Logs carry the decision id, proof id, preset and codes; never the link. | `test:U19c` |
| A forged, edited or replayed link | Full PRD §5 verification: Groth16 with the final vkey, roots on chain, bundle checks, the bot's own reader id, expiry. | `test:U11` `test:U09` `test:U10` `test:U20` |
| An RPC or index outage turns into an approval | Any unreadable chain state is INCONCLUSIVE; a bug in a dependency throws instead of deciding. | `test:U12` `test:U12b` `test:U12c` `test:U12d` |
| A silently edited policy | The policy hash is part of every decision and of the agent card; the file is validated at startup. | `test:U18` `test:U18b` `test:U18c` |
| A spoofed client IP to dodge the limit | The IP comes from the host's trusted header (`TRUSTED_IP_HEADER`, cf-connecting-ip on Render), as for the relayer (D29). | `web/src/server/relay-route.ts` |

## Revocation (D35)

| Threat | Control | Shown by |
|---|---|---|
| Someone other than the holder revokes a link (a reader, an observer) | `revoke` takes the secret, not the salt; the salt is Poseidon(4, secret), so knowing the link (and its salt) is not enough. Another secret marks another salt and leaves this link VALID. | `test:RV02` `test:RV11` `test:RV05` |
| The revoke secret is stolen (a vault backup, a shared device) | It opens nothing but this link's revocation: the thief can revoke that one link early (a denial of the holder's own link). The secret is encrypted in the vault like note secrets and never sent anywhere but the relayer's revoke route, which never logs it. | `test:R46` `test:RV24` |
| A revoke tx in the mempool is copied and sent first | It revokes the same salt, which is what the holder asked for; the holder's tx then reverts AlreadyRevoked and the page reads the chain. | `test:RV06` `test:RV22` |
| A revoked link edited to say v1, to skip the check | Every link's salt is checked, whatever its version; the edit is still ProofRevoked. | `test:RV13` `evidence/mutation-revoke-code.md` |
| An RPC outage or a missing registry turns a revoked link into VALID | The read failing is INCONCLUSIVE (ChainUnreachable); no configured registry is NotConfigured; the web build, the bot CLI and the SDK refuse to run without an address. An address with no code answers "0x", which is an error, not "not revoked". | `test:RV14` `test:U31` `test:S21` `test:W16` |
| A dishonest RPC hides a revocation | Not prevented: every chain fact comes from the RPC, as for roots (the SDK's trust model). Use an RPC you trust. | `packages/sdk/README.md` |
| A double click, a retry or a restart sends two revokes | One relayer record per salt, ever; a lost answer is `unknown` and never resent; the page keeps `sending`/`unknown` and only reads the chain. | `test:R42` `test:R43` `test:RV22` `test:RV23` |
| The revoke drains the relayer | Gas cap 200,000 per revoke (77,796 measured) and the daily budget, as every route. | `test:R45` `evidence/revocations-gas.md` |
| The revoke tx ties the link to the holder | It is sent by the relayer, not the holder. It reveals the secret and the salt; tying it to an on-chain attest needs the reader id and the expiry (LIMITS.md). | `LIMITS.md` |

## Reader codes (D36)

| Threat | Control | Shown by |
|---|---|---|
| Guessing the code offline from the link and the name | 80 random bits from the browser's CSPRNG; measured 439 guesses/s on one core: 4.37e13 years expected, 4.37e7 years at an assumed 1,000,000× speed-up. A link lives at most 365 days and can be revoked. | `evidence/reader-code-work.md` `test:RC06` |
| The code leaks through the link | The link carries only the code-bound reader id; the code is in it in no form. | `test:RC07` |
| The code leaks through the vault, the server or logs | The vault schema has no field for it; no server route takes it; /v and the prove form keep it in memory only. The fork fixture checks its own output and log. | `test:RV24` `packages/shaida-pay/scripts/privacy-fixture.ts` |
| A code-protected link relabelled name-only (or v1) to drop the code | The reader check uses the link's reader id, which includes the code's hash: WrongReader. | `test:RC04` `test:S23` |
| Opened without a code, a code link falls back to the name | Refused: a code link with no code is WrongReader, offline. | `test:RC02` `evidence/mutation-revoke-code.md` |
| A weak code (typed by hand, reused) | Not prevented: the page only makes random codes, but the prove form accepts any well-formed one. LIMITS.md says the bound holds for page-made codes. | `LIMITS.md` |

## Not covered
- Who holds a link: the reader name is intent, not identity (LIMITS.md); a reader code is a shared secret, not a login.
  The bot is name-only and cannot tell a holder from the person who was paid.
- An operator who changes the server's code could keep links. The CLI runs the same engine locally.
- Uptime and abuse beyond one process's view are not measured.
