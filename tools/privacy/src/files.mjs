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
  return { chainId: d.chainId, rpc: d.rpc, contracts, token: d.token.address.toLowerCase(), fromBlock };
}

/** JSON with bigints as decimal strings, two-space indent, trailing newline. */
export const jsonOut = (v) => `${JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)}\n`;
