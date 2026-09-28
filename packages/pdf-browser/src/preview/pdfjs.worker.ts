import "../quiet-worker-console";
// PDF.js initializes its own WorkerMessageHandler on this native worker.
// No task framework, fake-worker fallback or document scripts/viewer code.
// Static initialization installs the message handler before queued messages run.
// A top-level dynamic import can yield and lose the initial PDF.js handshake.
import "pdfjs-dist/build/pdf.worker.mjs";
export {};
