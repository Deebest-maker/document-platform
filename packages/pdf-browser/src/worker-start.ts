// M7H (ADR-038). A worker that fails before it has sent a single message never
// started: its script could not be fetched (a connection that dropped after the
// page loaded). That says nothing about the document, so it must not be worded
// as a failure of the work. A worker that fails after it has spoken did start,
// and the failure is the work's. Call this as soon as the worker is created.
export function watchWorkerStart(worker: Worker): () => boolean {
  let heard = false;
  worker.addEventListener(
    "message",
    () => {
      heard = true;
    },
    { once: true },
  );
  return () => heard;
}
