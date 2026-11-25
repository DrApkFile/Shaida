// Serves the fork fixture replay on a fixed port for the examples: pnpm --filter @shaida/sdk fixture-rpc [--port 8565]
import { FIXTURE, startFixtureRpc } from "./fixture-rpc";

const i = process.argv.indexOf("--port");
const port = i >= 0 ? Number(process.argv[i + 1]) : 8565;
const rpc = await startFixtureRpc({}, port);
const network = JSON.stringify(FIXTURE.network, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
console.log(`fixture RPC (replay of the fork run, chain ${FIXTURE.chainId}, head ${FIXTURE.head}) on ${rpc.url}`);
console.log(`SHAIDA_NETWORK='${network}' RPC_URL=${rpc.url}`);
for (const l of FIXTURE.links) console.log(`link ${l.name} (holder ${l.holder}, reader "${l.reader}"): ${l.url.slice(0, 40)}…`);
