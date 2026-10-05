import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const braces = require("braces");

assert.deepEqual(braces("src/{app,pages}/**/*.ts"), [
  "src/(app|pages)/**/*.ts",
]);

const maliciousPattern = `${"{".repeat(3_500)}a${"}".repeat(3_500)}`;

assert.throws(
  () => braces(maliciousPattern),
  (error) =>
    error instanceof SyntaxError &&
    error.message === "Brace nesting depth (101) exceeds maximum (100)",
);

console.log(
  "Vendored braces rejects excessive nesting and preserves ordinary expansion.",
);
