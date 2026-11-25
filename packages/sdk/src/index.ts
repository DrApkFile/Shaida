// @shaida/sdk: verify a Shaida income proof link against the Aevum testnet RPC, without Shaida's website or server.
// The public surface is exactly what README.md "API reference" documents (test S13 fails on any difference).
export { decodeIncomeLink } from "./decode";
export { verifyIncomeLink } from "./verify";
export { checkOnChain, CHECK_GAS } from "./check";
export { underwrite, definePolicy, RENT_CHECK, REVENUE_CREDIT, type UnderwriteOptions } from "./underwrite";
export { ShaidaConfigError } from "./session";
export { AEVUM_TESTNET } from "./network";
export { PINNED } from "./pins";
export { CODES } from "./codes";
export type {
  CodeInfo, CustomNetwork, Decision, DecisionFacts, DeclineCode, Decoded, DecodedLink, InconclusiveCode, InvalidCode, NetworkConfig,
  OnChainCheck, Policy, PolicyInput, ReadOptions, Refused, RuleCode, ShaidaErrorInfo, Valid, Verification, VerifyCode, VerifyOptions,
} from "./types";
