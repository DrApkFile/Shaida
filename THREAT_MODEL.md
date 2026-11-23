# Threat model

PRD §8 is the security model for the contracts, the circuit, the relayer and the browser vault. This file adds what
the underwriting bot (D30) brings: a public decision endpoint and a key of its own. Each threat names its control and
the test or evidence that shows it.

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

## Not covered
- Who holds a link: the reader name is intent, not identity (LIMITS.md). The bot cannot tell a holder from the person
  who was paid.
- An operator who changes the server's code could keep links. The CLI runs the same engine locally.
- Uptime and abuse beyond one process's view are not measured.
