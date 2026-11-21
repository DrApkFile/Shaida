// `make fork` only: register a demo payer with the fork's attestor (anvil account 0, a PUBLIC test key) and mint it
// tUSD8 by impersonating tUSD8's master minter, as `make deal` does. Never runs against another chain.
import { createWalletClient, http, keccak256, parseAbi, stringToHex, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const FORK_CHAIN_ID = 440050;
const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
const MASTER_MINTER = "0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1" as const;

const registryAbi = parseAbi(["function register(address account, bytes32 nameHash) returns (uint32)", "function activeIdOf(address) view returns (uint32)"]);
const tokenAbi = parseAbi(["function configureMinter(address minter, uint256 allowance) returns (bool)", "function mint(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

export async function assertFork(client: PublicClient): Promise<void> {
  const id = await client.getChainId();
  if (id !== FORK_CHAIN_ID) throw new Error(`RPC is chain ${id}; this script only runs on make fork (${FORK_CHAIN_ID})`);
}

export async function registerPayer(client: PublicClient, rpc: string, registry: Address, payer: Address, displayName: string): Promise<{ payerId: number; hash: `0x${string}` }> {
  await assertFork(client);
  const attestor = createWalletClient({ account: privateKeyToAccount(ANVIL_0_KEY), transport: http(rpc) });
  const hash = await attestor.writeContract({ chain: null, address: registry, abi: registryAbi, functionName: "register", args: [payer, keccak256(stringToHex(displayName))], type: "legacy" });
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`register reverted (${hash})`);
  return { payerId: await client.readContract({ address: registry, abi: registryAbi, functionName: "activeIdOf", args: [payer] }), hash };
}

export async function mintTusd8(client: PublicClient, rpc: string, to: Address, amount: bigint): Promise<void> {
  await assertFork(client);
  await client.request({ method: "anvil_impersonateAccount" as never, params: [MASTER_MINTER] as never });
  await client.request({ method: "anvil_setBalance" as never, params: [MASTER_MINTER, "0x56BC75E2D63100000"] as never });
  const mm = createWalletClient({ account: MASTER_MINTER, transport: http(rpc) });
  for (const [fn, args] of [["configureMinter", [MASTER_MINTER, 10n ** 15n]], ["mint", [to, amount]]] as const) {
    const hash = await mm.writeContract({ chain: null, address: TUSD8, abi: tokenAbi, functionName: fn, args: args as never, type: "legacy" });
    if ((await client.waitForTransactionReceipt({ hash })).status !== "success") throw new Error(`${fn} reverted`);
  }
}

export const tusd8Balance = (client: PublicClient, who: Address) => client.readContract({ address: TUSD8, abi: tokenAbi, functionName: "balanceOf", args: [who] });
