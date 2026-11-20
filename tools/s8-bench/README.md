# Spike S8: browser proving time, 4 slots vs 8 slots

A static page that builds a random valid witness (every slot used), then calculates the witness, proves (Groth16)
and verifies in a fresh Web Worker per run, for the production 4-slot income circuit (D12) and an 8-slot comparison
variant (`circuits/income8.circom`: the same `Income` template, so identical constraints per slot, circom 2.2.3
`--O2`). It shows witness, prove, verify, total and zkey-load times, `navigator.hardwareConcurrency` and the user
agent. The report is saved after every run, so a run that stalls keeps the runs before it (`complete: false`).

**Keys are THROWAWAY**: one local contribution each, made on your machine by `make s8-build` from your Hermez ptau.
Whoever makes them could forge proofs, so they are never committed (`build/`, `www/` are gitignored), never deployed
and never published. Proving time does not depend on who made the key.

## Regenerate the keys and the page
```bash
make s8-build PTAU_PATH=powers/powersOfTau28_hez_final_17.ptau
```
Checks the ptau's blake2b against briefing/CEREMONY.md, compiles both circuits, makes the keys (minutes each on an
i3 M 370; the 4-slot key is shared with `make test-groth16`, and each key is reused while its r1cs is unchanged) and
writes `www/`.

## Run it in Chrome on this machine
```bash
make s8-serve            # or, plain static: python3 -m http.server 8088 --directory tools/s8-bench/www
google-chrome http://localhost:8088/     # or: chromium http://localhost:8088/
```
Type the device into the "Device" field, pick the slots (4 and 8, 4 only, 8 only), press **Run**, and keep the tab
in front until "Done." The same choices work as a query: `?slots=4`, `?runs=2`, `?label=...`, `?auto=1`.
With `make s8-serve` the report is saved to `results/` by itself; with the python server use **Download JSON** and
put the file in `results/`.

## Run it on a phone (same Wi-Fi)
1. `make s8-serve`. It prints `same Wi-Fi: http://<laptop-ip>:8088`.
2. If the firewall blocks it: `sudo ufw allow 8088/tcp` (ufw) or
   `sudo firewall-cmd --add-port=8088/tcp` (firewalld); undo afterwards.
3. Open that address in the phone's browser (for one variant: `http://<laptop-ip>:8088/?slots=4`), fill in
   "Device", run, keep the screen on until "Done." The report is saved on the laptop in `results/` after every run.

Plain `http://` on the LAN works: the page needs Web Workers and `crypto.getRandomValues`, not a secure context.
Every run downloads its zkey again in its fresh worker (25.3 MiB for 4 slots, 50.6 MiB for 8; not in the total).

## Record
```bash
make s8-headless RUNS=3 SLOTS=both  # optional: headless Chromium on this machine, saved with CPU/RAM details
make s8-record                      # writes evidence/s8-browser.md from results/ and results/reported/
```
A result the page could not save (for example a phone run before the save-after-every-run fix) goes in
`results/reported/` as a `shaida-s8-reported/1` file, and the evidence marks it **reported**.
