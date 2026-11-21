// eth_getLogs over any range in pages Aevum accepts. The node's rule is toBlock − fromBlock ≤ 1000 (S3,
// AEVUM_INTEGRATION §5); pages here span at most MAX_PAGE_SPAN = 999, one block inside it.

/** Largest toBlock − fromBlock of one page. */
export const MAX_PAGE_SPAN = 999n;

export interface RetryPolicy {
  /** Tries per page, the first included. */
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 5, baseDelayMs: 500, maxDelayMs: 8_000 };

export interface Page {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

/** The pages of [fromBlock, toBlock], low to high, each with toBlock − fromBlock ≤ span. */
export function pagesOf(fromBlock: bigint, toBlock: bigint, span: bigint = MAX_PAGE_SPAN): Page[] {
  if (span < 0n || span > MAX_PAGE_SPAN) throw new RangeError(`page span must be 0..${MAX_PAGE_SPAN}`);
  const pages: Page[] = [];
  for (let start = fromBlock; start <= toBlock; start += span + 1n) {
    const stop = start + span > toBlock ? toBlock : start + span;
    pages.push({ fromBlock: start, toBlock: stop });
  }
  return pages;
}

/** Thrown when one page still fails after every retry. Pages before it were delivered. */
export class PageFailed extends Error {
  constructor(
    readonly page: Page,
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(`eth_getLogs ${page.fromBlock}..${page.toBlock} failed ${attempts} times: ${describe(lastError)}`);
    this.name = "PageFailed";
  }
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Delay before try number `attempt` (1-based; attempt 1 has none): exponential, capped. */
export function backoffMs(attempt: number, policy: RetryPolicy): number {
  if (attempt <= 1) return 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 2));
}

export interface ReadPagesArgs<L> {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly getLogs: (page: Page) => Promise<readonly L[]>;
  /** Called once per page, in order, after it was read. Persist the cursor here. */
  readonly onPage: (page: Page, logs: readonly L[]) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly retry?: RetryPolicy;
  readonly span?: bigint;
}

/**
 * Reads pages one after another (the public RPC is shared), retrying each with backoff. A page that keeps
 * failing throws PageFailed; every page before it has already gone through onPage, so a caller that persists
 * its cursor there resumes at the failed page.
 */
export async function readPages<L>(args: ReadPagesArgs<L>): Promise<void> {
  const policy = args.retry ?? DEFAULT_RETRY;
  for (const page of pagesOf(args.fromBlock, args.toBlock, args.span)) {
    let lastError: unknown;
    let logs: readonly L[] | undefined;
    for (let attempt = 1; attempt <= policy.attempts && logs === undefined; attempt++) {
      const wait = backoffMs(attempt, policy);
      if (wait > 0) await args.sleep(wait);
      try {
        logs = await args.getLogs(page);
      } catch (e) {
        lastError = e;
      }
    }
    if (logs === undefined) throw new PageFailed(page, policy.attempts, lastError);
    await args.onPage(page, logs);
  }
}
