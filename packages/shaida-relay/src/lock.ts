/** A queue per chain: one task at a time, in order. Each store (one per server process) has its own. */
export function chainQueue() {
  const tails = new Map<number, Promise<unknown>>();
  return <T>(chainId: number, task: () => Promise<T>): Promise<T> => {
    const before = tails.get(chainId) ?? Promise.resolve();
    const p = before.then(task, task);
    tails.set(chainId, p.then(() => undefined, () => undefined));
    return p;
  };
}

/** The state-file store's queue: one submission per chain at a time in this process (D19). */
export const withChainLock = chainQueue();
