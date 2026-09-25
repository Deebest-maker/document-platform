// This module runs only in the dedicated, per-operation PDF worker.
// pdf-lib can warn about document-derived parser values even in strict mode.
// Discard library diagnostics at this isolated boundary; report safe codes only.
for (const method of [
  "log",
  "warn",
  "error",
  "info",
  "debug",
  "trace",
  "dir",
  "table",
] as const) {
  console[method] = () => {};
}
