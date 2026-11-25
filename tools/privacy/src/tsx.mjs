// Lets plain `node tools/privacy-reader.mjs` load @shaida/proofs (TypeScript): registers tsx, resolved from this package.
import { register } from "tsx/esm/api";

register();
