// Shape of one S8 report (what the page produces). Checked by serve.ts on upload and by record.ts.
import { z } from "zod";

const ms = z.number().nonnegative();
const run = z
  .object({
    variant: z.enum(["income8", "income4"]),
    run: z.number().int().positive(),
    inputMs: ms,
    cold: z.boolean(),
    zkeyLoadMs: ms.nullable(),
    wasmLoadMs: ms.nullable(),
    curveInitMs: ms.nullable(),
    witnessMs: ms,
    proveMs: ms,
    verifyMs: ms,
    totalMs: ms,
    verified: z.boolean(),
  })
  .strict();

export const reportSchema = z
  .object({
    schema: z.literal("shaida-s8/1"),
    label: z.string().max(200),
    userAgent: z.string().max(500),
    hardwareConcurrency: z.number().int().positive().nullable(),
    deviceMemoryGiB: z.number().positive().nullable(),
    manifest: z
      .object({
        key: z.string(),
        compiler: z.string(),
        commit: z.string().regex(/^[0-9a-f]{40}$/),
        dirty: z.boolean(),
        builtAt: z.string(),
        variants: z.record(
          z.string(),
          z
            .object({
              slots: z.number(),
              constraints: z.number(),
              r1csSha256: z.string(),
              wasmSha256: z.string(),
              zkeySha256: z.string(),
              zkeyBytes: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
    startedAt: z.string(),
    finishedAt: z.string(),
    runs: z.array(run).max(40),
    errors: z.array(z.string().max(1000)).max(40),
    /** Added by headless.ts only: the machine is known there. */
    host: z.object({ cpuModel: z.string(), logicalCpus: z.number(), ramGiB: z.number(), browser: z.string() }).strict().optional(),
  })
  .strict();

export type S8ReportFile = z.infer<typeof reportSchema>;
