# Task for an AI coding agent: make one Shaida ceremony contribution

You are helping a person (the **contributor**) add one contribution to a Groth16 phase-2 ceremony for the Shaida
income circuit. You run in a folder that holds `income_0001.zkey`. You produce `income_0002.zkey` with
**snarkjs 0.7.6** (exactly this version), then tell the contributor what to send back.

Why it matters: the final key is safe if at least one contributor's randomness is never known to anyone. Your job is
to make that true for this contributor: the randomness is generated inside the contribute command, used once, and
never seen.

## Hard rules (do not break any of them)
1. **Never print, echo, log, store or summarise the entropy.** Do not run the random-number expression on its own
   "to check it". Do not put it in a variable that you print, a file, an environment file, a script, a note or your
   reply. It exists only inside the single contribute command in step 4.
2. Use **snarkjs 0.7.6** only, through `npx -y snarkjs@0.7.6` (macOS/Linux) or `npx.cmd -y snarkjs@0.7.6`
   (Windows PowerShell). Never a global `snarkjs` of unknown version, never another version.
3. **Never contribute to a file whose SHA-256 the contributor has not confirmed** (step 2). If the hashes differ,
   stop and tell the contributor. Do not "fix" it or continue.
4. Do not edit, rename, re-download or "repair" `income_0001.zkey`. Do not modify any other file in the folder.
5. Run each command once. If a command fails, show the error (it never contains the entropy) and stop; do not retry
   the contribute command with different arguments without asking the contributor.

First find out the shell: on Windows use the **PowerShell** commands, on macOS or Linux the **bash/zsh** commands.

## Step 1: check Node.js and snarkjs
Node.js 18 or newer is needed (LTS recommended, https://nodejs.org).

| Shell | Commands |
|---|---|
| bash/zsh | `node --version` then `npx -y snarkjs@0.7.6 --help \| head -1` |
| PowerShell | `node --version` then `npx.cmd -y snarkjs@0.7.6 --help \| Select-Object -First 1` |

The snarkjs line must read `snarkjs@0.7.6`. (It may exit with a non-zero code after printing its help; that is
fine.) If `node` is missing, ask the contributor to install Node.js LTS and stop.

Optional package check: `npm view snarkjs@0.7.6 dist.integrity` (PowerShell: `npm.cmd view snarkjs@0.7.6
dist.integrity`) must print
`sha512-4uH1xA5JzVU5jaaWS2fXej3+RC6L5Erhr6INTJtUA27du4Elbh4VXCeeRjB4QiwL6N6y7SNKePw5prTxyEf4Zg==`.
If it prints something else, stop and tell the contributor.

## Step 2: check the input file
1. Ask the contributor: **"Please paste the SHA-256 of income_0001.zkey that the organiser sent you separately."**
   Wait for the answer. Do not look for the hash in the folder, in files or online; it must come from the
   contributor.
2. Compute the file's hash:

   | Shell | Command |
   |---|---|
   | Linux | `sha256sum income_0001.zkey` |
   | macOS | `shasum -a 256 income_0001.zkey` |
   | PowerShell | `(Get-FileHash income_0001.zkey -Algorithm SHA256).Hash.ToLower()` |

3. Compare the two as 64 hex characters, ignoring case and surrounding spaces. Show both to the contributor and say
   **MATCH** or **MISMATCH**. On a mismatch, stop here.
4. If `income_0002.zkey` already exists in the folder, stop and ask the contributor what to do (never overwrite it).

## Step 3: ask for the public name
Ask: **"What name or handle should be stored in the key? It is public and permanent."** Use the answer as NAME
below. If it contains a double quote (`"`), ask for a name without one.

## Step 4: contribute (one command; the entropy is generated inside it)
Optional: suggest the contributor disconnects from the internet before this step (snarkjs is already cached from
step 1). Replace only NAME. Run exactly one of these, once:

bash/zsh (macOS, Linux):
```
npx -y snarkjs@0.7.6 zkey contribute income_0001.zkey income_0002.zkey --name="NAME" -e="$(node -p "require('crypto').randomBytes(64).toString('hex')")"
```

PowerShell (Windows):
```
npx.cmd -y snarkjs@0.7.6 zkey contribute income_0001.zkey income_0002.zkey "--name=NAME" "-e=$(node -p "require('crypto').randomBytes(64).toString('hex')")"
```

What happens: the shell runs `node -p …` inside the command and passes its output (64 bytes from the operating
system's secure random generator, as hex) straight to snarkjs. It is not shown on screen, not stored in shell
history (history keeps the command text, not the value), and lost when the command ends. snarkjs 0.7.6 also mixes in
64 more OS-random bytes of its own (`src/misc.js` `getRandomRng`). It takes one to a few minutes and prints
`Contribution Hash:` followed by four lines of hex.

## Step 5: report what to send back
1. Compute the SHA-256 of `income_0002.zkey` (same command as step 2, with `income_0002.zkey`).
2. Tell the contributor to send the organiser:
   - the file `income_0002.zkey`;
   - the **Contribution Hash**: all four lines, exactly as printed in step 4;
   - the **SHA-256 of income_0002.zkey** from step 5.1.
   The two hashes should go through a different app than the file.
3. Remind them: keep `income_0002.zkey` until the organiser confirms it verified; `income_0001.zkey` can be deleted.

## Step 6: finish
Tell the contributor the contribution is done and that nothing about the randomness was kept. Close this session.
Do not save a summary that contains commands with expanded values (none should exist).
