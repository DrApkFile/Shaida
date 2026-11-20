# LANDSCAPE

Researched: 2026-11-20 (GitHub/web search; DoraHacks BUIDL gallery not reachable from here, so this list is partial)

## House style at this event
Starter-kit `Checkout.sol` extended into invoice/escrow/pay-link, plus a "capped AI agent" vault (per-tx cap, daily cap, allowlist, expiry, revoke), tUSD8 gasless via EIP-3009, README tables of chain facts and tx hashes. This mirrors PQA Labs' own announced products (Signet: agents pay within owner limits; Trellis: owners approve spending).

## Neighbours
| Project | What it does | Link | Positioning line | Judge Q&A |
|---|---|---|---|---|
| AevumPay (Tiannuryadins) | Invoice escrow, refund after expiry | github.com/Tiannuryadins/aevum-pay | Public invoice settlement | Shaida is about proving income afterwards, privately |
| PayLink (several) | Payment-request links | github.com/ZhangHaozhi001/aevum-paylink and forks | Getting paid | Shaida is about proving you were paid, without exposing the wallet |
| AevumBill | Tamper-proof invoices | github.com/solivansprvill-droid/aevum-bill | Invoice integrity | Ours: integrity of an income claim |
| PayeeGuard (two repos) | Confirmation of payee; ERC-4337 session keys | github.com/emilhuseyn/aevum-qday, github.com/PecintaMajor/payeeguard | Payer verifies payee | Mirror image: verifier checks the payer vouched |
| Float, SpendGuard, Otto | Capped agent vaults/budgets | github.com/web3wizzz/float, github.com/Admuad/Spendguard, github.com/Godson-droid/otto | Agent spending limits | We don't compete on agent caps |
| PayStream | Per-second payroll streams + capped agent | github.com/teethaking/PayStream | Public payroll | Ours: private pay with provable totals |
| SealPay | ML-DSA-signed invoices verified on-chain | github.com/KaushalGoud/SealPay | PQ signatures | Strongest "PQ" story in the field; we don't claim PQ |
| AevumPay (Chichuzxy), AgentEscrow, AutoTasker | Metered agent payments, agent escrow, x402 data | github.com/Chichuzxy/aevum-pay etc. | Agent commerce | Different problem |
| **Gloam** (not an entrant) | ZK shielded pool, private payroll, x402, receipt/solvency/payroll-total proofs; 4+ mainnets | github.com/gloamtrade/gloam | Our privacy engine | Gloam proves balances and payments sent; Shaida adds vouched income received over time |

## The gap we fill
No entrant does privacy. No entrant (and not Gloam) proves **income received over a period, vouched for by known payers, shown to one named reader with an expiry**. Every entrant's on-chain activity is fully public. Our privacy-plus-accountability stance matches Abelian's "privacy with accountability" model and PQA Labs' compliance positioning.

## Prepared judge questions
- Q: Isn't this just Gloam on Aevum? A: Gloam is the private-payment engine (MIT, credited). Shaida's circuit, payer registry, signing flow, verifier and Aevum contracts are new. Gloam has no income-received proof and no payer vouching.
- Q: Can't I pay myself? A: Only payments signed by a registered payer count. Self-payment produces no valid signature. Collusion with a registered payer is a stated limit (same as fake payslips).
- Q: Can you prove income below X? A: No. Lower bounds only, stated in LIMITS.md, with a roadmap path.
- Q: Is it quantum-safe? A: No. Aevum's post-quantum accounts are on QDay's 2027 roadmap. We don't claim PQ.
- Q: Where's the privacy on a testnet with few users? A: Thin anonymity set, stated openly. The design is correct; privacy grows with volume.
