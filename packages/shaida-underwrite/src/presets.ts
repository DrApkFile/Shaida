// The shipped presets (config/underwrite-policies.json), parsed when this module loads: a bad config stops the
// server at startup (instrumentation imports this) and fails the tests, never a request.
import raw from "../../../config/underwrite-policies.json";
import { parsePolicies, type Policy } from "./policy";

export const PRESETS: readonly Policy[] = parsePolicies(raw);

export const presetById = (id: string): Policy | undefined => PRESETS.find((p) => p.id === id);
