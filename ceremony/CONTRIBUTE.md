# Contributing to the Shaida ceremony

Thank you for helping. Shaida's income proofs use a Groth16 key. Anyone who knows all the randomness used to make
that key could forge proofs, so the key is made by several people in turn. Each person mixes in their own secret
randomness and then forgets it. If **any one** contributor really forgets theirs, nobody can forge proofs.

You will spend about 15 minutes. You need a computer with about 200 MB free and an internet connection for the
install (you can go offline before you contribute).

## What you get from the organiser
- One file, `income_0001.zkey` (about 25 MiB).
- Its SHA-256 hash, sent **through a different channel** than the file (for example the file by email or a file
  link, the hash by text message or in person). It is also in `ceremony/TRANSCRIPT.md` of the public repository.

## 1. Install Node.js and snarkjs 0.7.6
1. Install Node.js 22 LTS from https://nodejs.org (any 20+ works).
2. In a terminal:
   ```
   npm install -g snarkjs@0.7.6
   snarkjs --help | head -1
   ```
   The second command must print `snarkjs@0.7.6`. If it prints another version, run the install again with the
   exact version. On Windows PowerShell use `snarkjs --help | Select-Object -First 1`; if PowerShell refuses to
   run `npm` or `snarkjs` scripts, call `npm.cmd` / `snarkjs.cmd` instead.
   (No global install wanted? Use `npx -y snarkjs@0.7.6` in place of `snarkjs` in every command below; on
   Windows PowerShell `npx.cmd -y snarkjs@0.7.6`.)

## 2. Check the file you received
In the folder that holds `income_0001.zkey`, run the command for your system:

| System | Command |
|---|---|
| Linux | `sha256sum income_0001.zkey` |
| macOS | `shasum -a 256 income_0001.zkey` |
| Windows (PowerShell) | `Get-FileHash income_0001.zkey -Algorithm SHA256` |

The printed hash must equal the one the organiser sent you, every character (Windows prints it in capitals; that is
fine). **If it differs, stop** and tell the organiser. Do not contribute to a file you have not checked.

## 3. Contribute (one command)
Optional but good: disconnect from the internet now.

```
snarkjs zkey contribute income_0001.zkey income_0002.zkey --name="Your name or handle"
```

- `--name` is stored inside the file for good and will be shown publicly next to your contribution. Use a name or
  handle you are happy to publish.
- It asks `Enter a random text. (Entropy):`. Type a long, random string: mash the keyboard for a while (100+
  characters). Do not use a password or anything you could remember. Press Enter.
  snarkjs also mixes in randomness from your operating system.
- Never type your own random text on the command line (with `-e`): it would stay in your shell history. (The
  agent route, `CONTRIBUTE-FOR-AGENT.md`, does use `-e`, but with 64 random bytes generated inside the command, so
  no one ever sees or types them.)
- It takes a minute or two, then prints `Contribution Hash:` followed by four lines of hex.

## 4. Send back
1. The new file `income_0002.zkey`.
2. The whole `Contribution Hash` (all four lines), copied from your terminal.
3. Its SHA-256 hash (same command as in step 2, on `income_0002.zkey`).

Send the hashes through the second channel, as in "What you get".

## 5. Forget your randomness
- Delete any note of what you typed (paper, a text file, a clipboard manager).
- Close the terminal window.
- You may delete `income_0001.zkey`. Keep `income_0002.zkey` until the organiser confirms it verified.

## What happens next
The organiser checks your file against the circuit and the public phase-1 file (`snarkjs zkey verify`) and checks
that the contribution hash inside it equals the one you sent. Then a public random value (the hash of an Aevum
block whose number is announced before it exists) is applied, and the final key is published with every
contributor's name and hash in `ceremony/TRANSCRIPT.md`. You can check your hash there.
