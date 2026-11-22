# Deploy to Render (free) with Upstash Redis

The steps the builder does by hand, in order. The design is DECISIONS D29. Nothing here creates an account or sets a
secret for you; every secret is pasted by you into the provider's dashboard, never into a file or a shell.
Measured in a local rehearsal of the free instance (512 MB, 0.1 CPU, real 44005 chain, Redis via Upstash's REST
protocol): ready in 37 s, peak 173 MB, build peak 2.09 GB ([evidence/render-rehearsal.md](evidence/render-rehearsal.md)).
Render itself has not run this yet.

## 0. Before you start
- The branch to deploy is merged into `master` and pushed (Render builds from GitHub).
- You have: the relayer key (Foundry keystore `shaida-relayer`, address `0xF4945dD57C8de1C637966179df5b631689901422`).
- Pick one region for both services. Suggested: **Frankfurt** (Render "Frankfurt (EU Central)", Upstash
  "eu-central-1"); the same region keeps each Redis command short.

## 1. Upstash Redis database (free, no credit card)
1. Sign up at https://upstash.com (GitHub or email). Do not add a card.
2. Console → **Redis** → **Create database**.
   - Name: `shaida`
   - Type / plan: **Free**
   - Primary region: **eu-central-1 (Frankfurt)** (or the region you chose above). No read regions.
   - Eviction: **off** (request records must never be evicted).
3. Open the database → **REST API** section. Copy `UPSTASH_REDIS_REST_URL` (an `https://…upstash.io` URL) and
   `UPSTASH_REDIS_REST_TOKEN` (the read-write token, not the read-only one). You paste both into Render in step 2.

Free tier (Upstash pricing page, 2026-11): 500K commands a month, 250 MB data, 10 MB per request, one database.
Measured use: a relayed transaction costs 8 commands, a status poll 1–2, an index poll 0–1 (test R30, D29).

## 2. Render web service
1. Sign up at https://render.com with GitHub and allow access to the `DrApkFile/Shaida` repository.
2. **New → Web Service** → pick `DrApkFile/Shaida`.
3. Settings:

   | Field | Value |
   |---|---|
   | Name | `shaida` (the URL becomes `https://shaida.onrender.com`, or with a suffix if taken) |
   | Language | Node |
   | Branch | `master` |
   | Region | Frankfurt (EU Central) |
   | Root Directory | *(empty: the repository root)* |
   | Build Command | `bash tools/render-build.sh` |
   | Start Command | `cd web && exec ./node_modules/.bin/next start` |
   | Instance Type | **Free** |

4. **Advanced**:
   - Health Check Path: `/api/health`
   - Auto-Deploy: **On Commit** (or Off, if you prefer to deploy by hand)
   - Render clones the git submodules itself (Gloam is a public submodule; `tools/render-build.sh` stops if it is
     missing).
5. **Environment** (Add Environment Variable; mark the two secrets as secret if offered):

   | Key | Value | Notes |
   |---|---|---|
   | `NODE_VERSION` | `24.19.0` | the version every local measurement used |
   | `NEXT_PUBLIC_NETWORKS` | `aevum` | exactly this; the build refuses anything else |
   | `NEXT_PUBLIC_SHAIDA_AEVUM` | the JSON line printed by `node tools/write-web-env.mjs --network aevum --print` (everything after `NEXT_PUBLIC_SHAIDA_AEVUM=`) | public contract addresses and start block from deployments/aevum.json |
   | `NEXT_PUBLIC_REPO_URL` | `https://github.com/DrApkFile/Shaida` | the header's GitHub link |
   | `UPSTASH_REDIS_REST_URL` | from step 1 | |
   | `UPSTASH_REDIS_REST_TOKEN` | from step 1 | **secret** |
   | `RELAYER_PRIVATE_KEY` | the relayer key, read with `cast wallet decrypt-keystore shaida-relayer` (hidden password prompt) and pasted straight into the field | **secret**; never into a file or chat |
   | `TRUSTED_IP_HEADER` | `cf-connecting-ip` | the visitor's IP for the relayer's rate limit (Render puts Cloudflare in front) |
   | `RELAYER_DAILY_GAS_BUDGET` | `30000000` | caps the public relayer at ~0.03 tQDAY a day (live run 2 needs ~18.9M gas with its withdrawal batch) |

   Do **not** set: `SHAIDA_STORE` (unset = Redis in production; `file` is refused on Render), `SHAIDA_DATA_DIR`,
   `NEXT_PUBLIC_SHAIDA_FORK`, `NEXT_PUBLIC_SHAIDA_INCOME_KEY` (default `final`; `throwaway` is refused on 44005),
   `NEXT_PUBLIC_SHAIDA_EXAMPLE_LINK` (the landing page's example is live run 1's link, committed in
   `web/src/app/example-links.json`; the variable is only used for chains with no recorded run).
   `NEXT_PUBLIC_*` values are baked in at build: change one → **Manual Deploy → Clear build cache & deploy**.

6. **Create Web Service**. The first build runs `tools/render-build.sh`: pinned circom 2.2.3, `pnpm install`, the
   income circuit, then `next build`. In the log, look for these lines (each file is refused unless its sha256 matches
   the pins):
   ```
   ✓ web/public/gloam/shield_final.zkey   (… transfer_final, unshield_final, and the three .wasm)
   ✓ income_final.zkey cbcb06fecdf72b47… downloaded from https://github.com/DrApkFile/Shaida/releases/download/ceremony-v1/income_final.zkey
   ✓ web/public/circuits/income/income.wasm (8fb36f38c220…), income_final.zkey (cbcb06fecdf7…, release ceremony-v1)
   ```
   and at start: `[startup] state store: redis (….upstash.io)`. If the log shows
   `[startup] StoreNotConfigured: …` the process exits by design: fix the variable it names and redeploy.

Render free limits (Render docs, 2026-11): 512 MB RAM, 0.1 CPU, spins down after 15 minutes without traffic (about
a minute to wake), 750 instance hours a month per workspace (one service running all month fits), builds on the
Starter pipeline (2 CPU, 8 GB) with 500 build minutes a month. The filesystem is wiped on every deploy, restart and
spin-down; nothing is kept there (D29).

## 3. UptimeRobot monitor (keeps the free instance awake)
1. Sign up at https://uptimerobot.com (Free plan).
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `shaida health`
   - URL: `https://<your-service>.onrender.com/api/health`
   - Monitoring Interval: **5 minutes**
   - Alert contact: your email (optional)
3. Save. `/api/health` makes no RPC call and no Redis command, so the pings cost nothing on Upstash.

## 4. Check the deployed site, logged out
Use a private window (no wallet, no extension) and a terminal:

```bash
SITE=https://<your-service>.onrender.com
curl -s $SITE/api/health
#   {"ok":true,"commit":"<the merged master SHA>","networks":[{"key":"aevum","chainId":44005}],"store":"redis",…}
git rev-parse origin/master            # must equal "commit" above
curl -s $SITE/ | grep -o 'See a live proof'
curl -sI $SITE/circuits/income/income_final.zkey | grep -i x-shaida-sha256
#   x-shaida-sha256: cbcb06fecdf72b47bb7d45d4403eaf69cf78bee65ad41cd50d0c98f4609cc0a5
curl -s $SITE/circuits/income/income_final.zkey | sha256sum     # the same hash
curl -s "$SITE/api/relay?chainId=44005"
#   {"enabled":true,"relayer":"0xF4945dD57C8de1C637966179df5b631689901422",…}
curl -s "$SITE/api/index?chainId=44005" | head -c 200   # repeat until "behind" is small; first sync reads ~25k blocks
```

In the private window:
1. `$SITE/`: the landing page; "See a live proof" says it expires 22 Dec 2026.
2. Click it (`/v#…`, live run 1's proof): type `Landlord Bola` → **VALID**, ≥ 3 tUSD8, 3 payments.
   **Check on-chain** passes (an `eth_call`, no wallet needed).
3. `$SITE/app`: the dashboard loads; "Pool and ledger trees" turns green once the index has synced.

Tell the coding agent the URL and the `/api/health` output; it records the deployment in evidence and CLAIMS from
what the live site shows.

## If something goes wrong
- Build stops at "contracts/lib/gloam is empty": submodules were not cloned; check that the repo's `.gitmodules`
  URLs are `https://` and redeploy.
- Build stops at a `✗ … sha256` line: a proving file differs from its pin. Do not work around it; tell the agent.
- `/api/relay` says `enabled:false`: `RELAYER_PRIVATE_KEY` is missing or malformed (the reply's `reason` says which).
- A deploy that is not live after the build: the start log names the refusal (`StoreNotConfigured`).
