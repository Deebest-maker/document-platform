import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "apps/web/public/vendor/pdfjs/6.3.289");
const upstream = path.dirname(
  createRequire(
    new URL("../packages/pdf-browser/package.json", import.meta.url),
  ).resolve("pdfjs-dist/package.json"),
);
const manifest = JSON.parse(
  await readFile(path.join(target, "manifest.json"), "utf8"),
);
const provenance = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/pdf-browser/assets/liberation-sans/2.1.5/provenance.json",
    ),
    "utf8",
  ),
);
const files = (await readdir(target, { recursive: true, withFileTypes: true }))
  .filter((f) => f.isFile())
  .map((f) =>
    path
      .relative(target, path.join(f.parentPath, f.name))
      .replaceAll("\\", "/"),
  )
  .sort();
assert.deepEqual(
  files,
  ["LICENSE", "manifest.json", ...manifest.files.map((f) => f.path)].sort(),
);
assert.equal(manifest.files.length, 198);
assert.equal(files.filter((f) => f.endsWith(".ttf")).length, 4);
assert(
  !files.some((f) =>
    /quickjs|sandbox|viewer|legacy|LICENSE_LIBERATION$|\.map$/.test(f),
  ),
);
for (const item of manifest.files) {
  const bytes = await readFile(path.join(target, item.path));
  assert.equal(bytes.length, item.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
}
for (const item of provenance.files.filter((f) => f.file.endsWith(".ttf"))) {
  const installed = await readFile(
    path.join(target, "standard_fonts", item.file),
  );
  assert.equal(
    createHash("sha256").update(installed).digest("hex"),
    item.sha256,
  );
  assert(
    !installed.equals(
      await readFile(path.join(upstream, "standard_fonts", item.file)),
    ),
  );
}
const notice = await readFile(
  path.join(target, "standard_fonts/LICENSE_LIBERATION_OFL"),
  "utf8",
);
assert.match(notice, /SIL OPEN FONT LICENSE Version 1\.1/);
assert.match(notice, /Red Hat/);
assert.match(notice, /Google/);
console.log(
  "PDF.js packaging verified: 198 reviewed assets, four unmodified OFL fonts, required notices, no bundled GPL fonts or unreviewed extras.",
);
