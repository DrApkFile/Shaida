/** One submission per chain at a time in this process, so nonces and the budget are read and used consistently. */
const tails = new Map<number, Promise<unknown>>();

export function withChainLock<T>(chainId: number, task: () => Promise<T>): Promise<T> {
  const before = tails.get(chainId) ?? Promise.resolve();
  const p = before.then(task, task);
  tails.set(chainId, p.then(() => undefined, () => undefined));
  return p;
}
