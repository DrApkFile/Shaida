# Spike S8: browser proving time, 8 slots vs 4 slots

A static page that builds a random valid witness (every slot used), then calculates the witness, proves (Groth16)
and verifies in a Web Worker, for the 8-slot income circuit and a 4-slot variant (`circuits/income4.circom`: the same
`Income` template, so identical constraints per slot, circom 2.2.3 `--O2`). It shows witness, prove, verify, total
and zkey-load times, `navigator.hardwareConcurrency` and the user agent.

**Keys are THROWAWAY**: one local contribution each, made on your machine by `make s8-build` from your Hermez ptau.
Whoever makes them could forge proofs, so they are never committed (`build/`, `www/` are gitignored), never deployed
and never published. Proving time does not depend on who made the key.

## Regenerate the keys and the page
```bash
make s8-build PTAU_PATH=powers/powersOfTau28_hez_final_17.ptau
```
Checks the ptau's blake2b against briefing/CEREMONY.md, compiles both circuits, makes the keys (about 8 min for the
4-slot key on an i3 M 370; the 8-slot key is shared with `make test-groth16` and reused while its r1cs is unchanged)
and writes `www/`.

## Run it in Chrome on this machine
```bash
make s8-serve            # or, plain static: python3 -m http.server 8088 --directory tools/s8-bench/www
google-chrome http://localhost:8088/     # or: chromium http://localhost:8088/
```
Type the device into the "Device" field, press **Run 8 and 4 slots**, and keep the tab in front until "Done."
With `make s8-serve` the report is saved to `results/` by itself; with the python server use **Download JSON** and
put the file in `results/`.

## Run it on a phone (same Wi-Fi)
1. `make s8-serve`. It prints `same Wi-Fi: http://<laptop-ip>:8088`.
2. If the firewall blocks it: `sudo ufw allow 8088/tcp` (ufw) or
   `sudo firewall-cmd --add-port=8088/tcp` (firewalld); undo afterwards.
3. Open that address in the phone's browser, fill in "Device", run, keep the screen on until "Done."
   The report is saved on the laptop in `results/`.

Plain `http://` on the LAN works: the page needs Web Workers and `crypto.getRandomValues`, not a secure context.
The phone downloads both zkeys (about 76 MiB) on the first run.

## Record
```bash
make s8-headless RUNS=3  # optional: headless Chromium on this machine, saved with CPU/RAM details
make s8-record           # writes evidence/s8-browser.md from every report in results/
```
