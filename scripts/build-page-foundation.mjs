import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const consumer = path.join(root, "apps/web/tests/page-foundation");
const target = path.resolve(consumer, "public/vendor/pdfjs");
if (!target.startsWith(path.resolve(consumer) + path.sep))
  throw new Error("Unsafe test asset target.");
await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(path.join(root, "apps/web/public/vendor/pdfjs"), target, {
  recursive: true,
});
const requireWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const child = spawn(
  process.execPath,
  [requireWeb.resolve("next/dist/bin/next"), "build"],
  {
    cwd: consumer,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      PDF_FOUNDATION_TEST: "1",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
