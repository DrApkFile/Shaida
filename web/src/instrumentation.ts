/** Runs once when the server starts, before it serves a request: the store check (startup.node.ts, D29). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkStoreAtStartup } = await import("./startup.node");
    checkStoreAtStartup();
  }
}
