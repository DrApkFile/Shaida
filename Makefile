# Shaida. Run `make help` for the list.
# Based on the Aevum Starter Kit Makefile (MIT, (c) 2026 PQA Labs, github.com/qday-io/aevum-starter-kit).
SHELL := /bin/bash
.DEFAULT_GOAL := help

AEVUM_RPC   ?= https://rpc-test.qday.info
# Own port, so wallets can hold it next to an existing "Localhost 8545" / anvil network
# (MetaMask refuses two networks with the same RPC URL).
FORK_PORT   ?= 8555
FORK_RPC    ?= http://127.0.0.1:$(FORK_PORT)
TUSD8       := 0x456569838f1d43009A91ebA4263147Afd7233483
# tUSD8's master minter. Only used on a local fork, where anyone can impersonate it.
TUSD8_MM    := 0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1
# anvil's first default account (public test account, local chains only).
ANVIL_0     := 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
AMOUNT      ?= 100
# `make fork` runs under its own chain ID so wallets and signatures never mix it up with the real testnet.
FORK_CHAIN  := 440050
AEVUM_CHAIN := 44005
# Gloam pool deposit limits for tUSD8, base units (6 decimals): 100 tUSD8 per deposit, 10,000 in total.
# Fixed at deploy; after endSetup they can only be lowered at once, or raised through Gloam's 3-day timelock.
TUSD8_PER_DEPOSIT := 100000000
TUSD8_TOTAL       := 10000000000
STACK_SCRIPT := script/DeployStack.s.sol:DeployStack
# PayerRegistry owner on `make fork`: anvil account 0, so payers can be registered locally. On 44005: ATTESTOR=0x... (required).
FORK_ATTESTOR := $(ANVIL_0)

.PHONY: help install build gate test test-fork test-groth16 ceremony-prepare ceremony-contribute ceremony-verify ceremony-supersede ceremony-beacon-announce ceremony-beacon-apply ceremony-finalize bench-circuit s8-build s8-serve s8-headless s8-record check anvil fork deploy-fork deploy-aevum verify-aevum secrets deal register-payer dev

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36mmake %-14s\033[0m %s\n", $$1, $$2}'

install: ## Fetch Solidity libs and JS packages
	git submodule update --init --recursive
	pnpm install
	node tools/copy-gloam-artifacts.mjs

build: ## Compile contracts (Shanghai-checked) and the income circuit
	cd contracts && forge build
	node tools/check-shanghai.mjs contracts/out
	pnpm --filter @shaida/proofs compile

gate: ## BUILD_CONTRACT gate in a fresh clone of HEAD (exit 0 PASS, 1 FAIL, 3 INCONCLUSIVE). GATE_IN_PLACE=1: this tree
	bash tools/gate.sh

test: ## Unit tests: contracts, circuit and witness builder (local, no network)
	cd contracts && forge test --no-match-path 'test/fork/*' -vv
	pnpm --filter @shaida/proofs test
	pnpm --filter @shaida/index test
	pnpm --filter @shaida/relay test
	pnpm --filter @shaida/pay test
	pnpm --filter @shaida/ceremony test

test-groth16: ## Full Groth16 proofs with a THROWAWAY local key. Needs PTAU_PATH=<Hermez 2^17 ptau>
	@test -n "$(PTAU_PATH)" || (echo "INCONCLUSIVE: set PTAU_PATH=/path/to/powersOfTau28_hez_final_17.ptau" && exit 1)
	cd packages/shaida-proofs && PTAU_PATH=$(abspath $(PTAU_PATH)) node --import tsx --test --test-reporter=spec test/income.groth16.test.ts

bench-circuit: ## Write evidence/income-circuit.md (constraints, throwaway zkey, Node proving time). Needs PTAU_PATH
	@test -n "$(PTAU_PATH)" || (echo "INCONCLUSIVE: set PTAU_PATH=/path/to/powersOfTau28_hez_final_17.ptau" && exit 1)
	PTAU_PATH=$(abspath $(PTAU_PATH)) pnpm --filter @shaida/proofs bench

test-fork: ## Tests against the real tUSD8 on a local fork of Aevum (no funds needed)
	cd contracts && forge test --match-path 'test/fork/*' --fork-url $(AEVUM_RPC) -vv

check: build test test-fork ## Everything CI runs
	pnpm -r typecheck

anvil: ## Empty local chain (31337) with Aevum's EVM rules
	anvil --hardfork shanghai

fork: ## Local copy of Aevum testnet on 127.0.0.1:8555 (chain 440050)
	anvil --fork-url $(AEVUM_RPC) --hardfork shanghai --chain-id $(FORK_CHAIN) --port $(FORK_PORT)

# Deploy from a random address nobody has the key for (anvil impersonates it), not from a public
# anvil account. Otherwise the fork's contract addresses could be claimed on the real testnet by
# anyone holding that public key.
deploy-fork: ## Deploy the stack (Poseidon, Gloam final verifiers, pool, memo, Shaida contracts) to `make fork`
	@test "$$(cast chain-id --rpc-url $(FORK_RPC))" = "$(FORK_CHAIN)" || (echo "This only works on 'make fork'." && exit 1)
	@DEPLOYER=$$(cast to-check-sum-address 0x$$(openssl rand -hex 20)); \
	  cast rpc anvil_setBalance $$DEPLOYER 0x8ac7230489e80000 --rpc-url $(FORK_RPC) > /dev/null && \
	  cast rpc anvil_impersonateAccount $$DEPLOYER --rpc-url $(FORK_RPC) > /dev/null && \
	  echo "Deploying from throwaway address $$DEPLOYER (no private key exists for it)" && \
	  cd contracts && TUSD8_PER_DEPOSIT=$(TUSD8_PER_DEPOSIT) TUSD8_TOTAL=$(TUSD8_TOTAL) ATTESTOR=$(FORK_ATTESTOR) \
	    forge script $(STACK_SCRIPT) --rpc-url $(FORK_RPC) --broadcast --legacy --slow --unlocked --sender $$DEPLOYER
	node tools/write-deployment.mjs --chain $(FORK_CHAIN) --rpc $(FORK_RPC) --out deployments/fork.json

deploy-aevum: ## Deploy the stack to Aevum testnet. Needs ACCOUNT=<keystore name>, ATTESTOR=0x... and a clean, committed tree
	@test -n "$(ACCOUNT)" || (echo "Set ACCOUNT=<name>. Create one with: cast wallet import <name> --interactive" && exit 1)
	@test -n "$(ATTESTOR)" || (echo "Set ATTESTOR=0x...: the address that registers and revokes payers." && exit 1)
	@test -z "$$(git status --porcelain)" || (echo "Commit first (untracked files and submodule changes count): deployments/aevum.json records the exact commit." && exit 1)
	@test "$$(cast chain-id --rpc-url $(AEVUM_RPC))" = "$(AEVUM_CHAIN)" || (echo "$(AEVUM_RPC) is not chain $(AEVUM_CHAIN)." && exit 1)
	cd contracts && TUSD8_PER_DEPOSIT=$(TUSD8_PER_DEPOSIT) TUSD8_TOTAL=$(TUSD8_TOTAL) ATTESTOR=$(ATTESTOR) \
	  forge script $(STACK_SCRIPT) --rpc-url $(AEVUM_RPC) --broadcast --legacy --slow --account $(ACCOUNT)
	node tools/write-deployment.mjs --chain $(AEVUM_CHAIN) --rpc $(AEVUM_RPC) --out deployments/aevum.json

secrets: ## gitleaks over the whole git history and the uncommitted changes (.gitleaks.toml)
	gitleaks detect --source . --config .gitleaks.toml --redact --no-banner
	gitleaks protect --source . --config .gitleaks.toml --redact --no-banner

verify-aevum: ## Read-only: rerun the deploy checks against deployments/aevum.json on Aevum testnet (sends nothing)
	@test -f deployments/aevum.json || (echo "deployments/aevum.json not found" && exit 1)
	TUSD8_PER_DEPOSIT=$(TUSD8_PER_DEPOSIT) TUSD8_TOTAL=$(TUSD8_TOTAL) node tools/verify-aevum.mjs

deal: ## `make fork` only: give TO AMOUNT tUSD8 and 10 tQDAY for gas
	@test -n "$(TO)" || (echo "Usage: make deal TO=0x... [AMOUNT=100]" && exit 1)
	@test "$$(cast chain-id --rpc-url $(FORK_RPC))" = "$(FORK_CHAIN)" || (echo "This only works on 'make fork'." && exit 1)
	@cast rpc anvil_setBalance $(TO) 0x8ac7230489e80000 --rpc-url $(FORK_RPC) > /dev/null
	@cast rpc anvil_impersonateAccount $(TUSD8_MM) --rpc-url $(FORK_RPC) > /dev/null
	@cast rpc anvil_setBalance $(TUSD8_MM) 0x56BC75E2D63100000 --rpc-url $(FORK_RPC) > /dev/null
	@cast send $(TUSD8) "configureMinter(address,uint256)" $(TUSD8_MM) 1000000000000000 --from $(TUSD8_MM) --unlocked --rpc-url $(FORK_RPC) > /dev/null
	@cast send $(TUSD8) "mint(address,uint256)" $(TO) $$(cast parse-units $(AMOUNT) 6) --from $(TUSD8_MM) --unlocked --rpc-url $(FORK_RPC) > /dev/null
	@echo "tUSD8 balance of $(TO): $$(cast call $(TUSD8) 'balanceOf(address)(uint256)' $(TO) --rpc-url $(FORK_RPC))"

register-payer: ## `make fork` only: the fork's attestor (anvil account 0) registers TO as a payer named NAME
	@test -n "$(TO)" || (echo 'Usage: make register-payer TO=0x... [NAME="Acme Studio (demo)"]' && exit 1)
	@test "$$(cast chain-id --rpc-url $(FORK_RPC))" = "$(FORK_CHAIN)" || (echo "This only works on 'make fork'." && exit 1)
	@test -f deployments/fork.json || (echo "deployments/fork.json not found: run make deploy-fork" && exit 1)
	@cast rpc anvil_impersonateAccount $(FORK_ATTESTOR) --rpc-url $(FORK_RPC) > /dev/null
	@cast send $$(node -p 'require("./deployments/fork.json").contracts.PayerRegistry.address') "register(address,bytes32)" $(TO) $$(cast keccak "$(or $(NAME),Acme Studio (demo))") \
	  --from $(FORK_ATTESTOR) --unlocked --legacy --rpc-url $(FORK_RPC) > /dev/null
	@echo "$(TO) is payer #$$(cast call $$(node -p 'require("./deployments/fork.json").contracts.PayerRegistry.address') 'activeIdOf(address)(uint32)' $(TO) --rpc-url $(FORK_RPC))"

s8-build: ## Spike S8: build the browser proving bench (4 vs 8 slots, THROWAWAY keys). Needs PTAU_PATH
	@test -n "$(PTAU_PATH)" || (echo "INCONCLUSIVE: set PTAU_PATH=/path/to/powersOfTau28_hez_final_17.ptau" && exit 1)
	PTAU_PATH=$(abspath $(PTAU_PATH)) pnpm --filter @shaida/s8-bench build

s8-serve: ## Spike S8: serve the bench on 0.0.0.0:8088 (saves results to tools/s8-bench/results/)
	pnpm --filter @shaida/s8-bench serve

s8-headless: ## Spike S8: run the bench in headless Chromium on this machine (RUNS=3, SLOTS=4|8|both)
	pnpm --filter @shaida/s8-bench headless $(or $(RUNS),3) $(or $(SLOTS),both)

s8-record: ## Spike S8: write evidence/s8-browser.md from tools/s8-bench/results/
	pnpm --filter @shaida/s8-bench record

# Phase-2 ceremony (briefing/CEREMONY.md). Zkey paths are relative to ceremony/.
CEREMONY := pnpm --silent --filter @shaida/ceremony

ceremony-prepare: ## Ceremony step 0: groth16 setup after the ptau/r1cs hash checks. Needs PTAU_PATH
	@test -n "$(PTAU_PATH)" || (echo "set PTAU_PATH=/path/to/powersOfTau28_hez_final_17.ptau" && exit 1)
	PTAU_PATH=$(abspath $(PTAU_PATH)) $(CEREMONY) prepare-setup

# Free text (names, reasons, hashes) reaches the scripts as environment variables, so quotes in it are safe.
ceremony-contribute ceremony-verify ceremony-supersede: export IN := $(IN)
ceremony-contribute ceremony-verify ceremony-supersede: export OUT := $(OUT)
ceremony-contribute ceremony-verify ceremony-supersede: export NAME := $(NAME)
ceremony-contribute ceremony-verify ceremony-supersede: export ZKEY := $(ZKEY)
ceremony-contribute ceremony-verify ceremony-supersede: export EXPECT := $(EXPECT)
ceremony-contribute ceremony-verify ceremony-supersede: export SHA256 := $(SHA256)
ceremony-contribute ceremony-verify ceremony-supersede: export REASON := $(REASON)

ceremony-contribute: ## Ceremony: one contribution. IN=work/… OUT=work/… NAME="…" (entropy at a hidden prompt)
	@test -n "$$IN" -a -n "$$OUT" -a -n "$$NAME" || (echo 'usage: make ceremony-contribute IN=work/income_0000.zkey OUT=work/income_0001.zkey NAME="Your name"' && exit 1)
	$(CEREMONY) contribute --in "$$IN" --out "$$OUT" --name "$$NAME"

ceremony-verify: ## Ceremony: snarkjs zkey verify + record. ZKEY=work/… [EXPECT="n:hash"]. Needs PTAU_PATH
	@test -n "$$ZKEY" -a -n "$(PTAU_PATH)" || (echo 'usage: make ceremony-verify ZKEY=work/income_0001.zkey PTAU_PATH=… [EXPECT="2:<hash>"]' && exit 1)
	PTAU_PATH=$(abspath $(PTAU_PATH)) $(CEREMONY) verify --zkey "$$ZKEY" $(if $(EXPECT),--expect "$$EXPECT")

ceremony-supersede: ## Ceremony: take the latest verified zkey off the chain (kept on record). SHA256=… REASON="…"
	@test -n "$$SHA256" -a -n "$$REASON" || (echo 'usage: make ceremony-supersede SHA256=<zkey sha256> REASON="why"' && exit 1)
	$(CEREMONY) supersede --sha256 "$$SHA256" --reason "$$REASON"

ceremony-beacon-announce: ## Ceremony: fix the beacon block (~2 h ahead on 44005). Commit and push right after
	$(CEREMONY) beacon announce

ceremony-beacon-apply: ## Ceremony: apply the announced block's hash (2^10 iterations) → work/income_final.zkey
	$(CEREMONY) beacon apply

ceremony-finalize: ## Ceremony: export vkey + Solidity verifier, Shanghai check, sample proof, hashes
	$(CEREMONY) finalize

dev: ## Start the web app on http://localhost:3000
	pnpm dev
