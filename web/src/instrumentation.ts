/** Runs once when the server starts, before it serves a request: the store check (D29) and the bot's settings (D30), in startup.node.ts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkBotAtStartup, checkStoreAtStartup } = await import("./startup.node");
    checkStoreAtStartup();
    await checkBotAtStartup();
  }
}
