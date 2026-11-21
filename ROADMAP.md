# ROADMAP

Ideas not built. Nothing here is claimed anywhere else.

- `IncomeVerifier.checkBundle` / `attestBundle`: the PRD §5 bundle rules on chain (one context, one root, disjoint
  ranges, Σ thresholds) for proofs of more than 4 payments. Today `check`/`attest` take one proof; bundles are
  verified off-chain by `verifyIncomeLink`.
- Deploy `IncomeVerifier` in `DeployStack.s.sol` once `ceremony/finalize.ts` has written the real verifier.

## Index and relayer state in a shared store
The index snapshot and the relayer's records, budget and rate windows live in files under `web/.data` (D18, D19). On a
serverless host each instance has its own copy. Move them to a KV store with atomic increments (PRD §10 P1).
