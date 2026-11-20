// SPDX-License-Identifier: GPL-3.0
// Spike S8 only: income.circom's Income template with 8 slots instead of the production 4 (D12), to compare
// browser proving time. Same template file, so the per-slot constraints are identical. Not a product circuit;
// never keyed for real.
pragma circom 2.1.6;

include "../../../packages/shaida-proofs/circuits/lib/income_template.circom";

component main {public [ledgerRoot, asset, threshold, count, fromIndex, toIndex, context]} = Income(8, 20);
