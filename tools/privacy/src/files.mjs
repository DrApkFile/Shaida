// Deployment records and JSON output for the privacy audit.

const KEYS = { pool: "ShieldPoolPoseidon", ledger: "ShaidaLedger", depositor: "ShaidaDepositor", registry: "PayerRegistry", memo: "GloamPayMemo", incomeVerifier: "IncomeVerifier" };

/** The six contracts an observer watches, and the first block any of them existed, from deployments/<net>.json. */
export function deploymentOf(d) {
  const contracts = {};
  let fromBlock = Infinity;
  for (const [k, name] of Object.entries(KEYS)) {
    const c = d.contracts?.[name];
    if (!/^0x[0-9a-fA-F]{40}$/.test(c?.address ?? "")) throw new Error(`${name} has no address in the deployment record`);
    contracts[k] = c.address.toLowerCase();
    if (Number.isInteger(c.block)) fromBlock = Math.min(fromBlock, c.block);
  }
  if (!Number.isFinite(fromBlock)) throw new Error("the deployment record has no deploy blocks");
  if (!/^0x[0-9a-fA-F]{40}$/.test(d.token?.address ?? "")) throw new Error("the deployment record has no token address");
  // D35: Revocations is a separate record (deployed later); watched when present. Its deploy block is not the stack's.
  if (d.revocations !== undefined) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(d.revocations?.address ?? "")) throw new Error("the deployment's revocations record has no address");
    contracts.revocations = d.revocations.address.toLowerCase();
  }
  return { chainId: d.chainId, rpc: d.rpc, contracts, token: d.token.address.toLowerCase(), fromBlock };
}

/** JSON with bigints as decimal strings, two-space indent, trailing newline. */
export const jsonOut = (v) => `${JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)}\n`;
