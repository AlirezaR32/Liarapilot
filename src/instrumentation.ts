// Next.js instrumentation: boot the LiaraPilot engine when the server starts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startEngine } = await import('@/lib/workers/engine');
  await startEngine();
}
