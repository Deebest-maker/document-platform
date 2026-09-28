import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const requirePdf = createRequire(
  new URL("../packages/pdf-browser/package.json", import.meta.url),
);
const source = path.dirname(requirePdf.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(
  await readFile(path.join(source, "package.json"), "utf8"),
);
if (version !== "6.3.289")
  throw new Error("Review PDF.js assets before changing version.");

// Each directory is a deliberate subset. Never copy the vendor package wholesale.
const groups = {
  cmaps: [
    ...(await readdir(path.join(source, "cmaps"))).filter((name) =>
      /^[A-Za-z0-9_-]+\.bcmap$/.test(name),
    ),
    "LICENSE",
  ],
  standard_fonts: [
    "FoxitDingbats.pfb",
    "FoxitFixed.pfb",
    "FoxitFixedBold.pfb",
    "FoxitFixedBoldItalic.pfb",
    "FoxitFixedItalic.pfb",
    "FoxitSerif.pfb",
    "FoxitSerifBold.pfb",
    "FoxitSerifBoldItalic.pfb",
    "FoxitSerifItalic.pfb",
    "FoxitSymbol.pfb",
    "LICENSE_FOXIT",
  ],
  wasm: [
    "jbig2.wasm",
    "jbig2_nowasm_fallback.js",
    "openjpeg.wasm",
    "openjpeg_nowasm_fallback.js",
    "qcms_bg.wasm",
    "LICENSE_JBIG2",
    "LICENSE_PDFJS_JBIG2",
    "LICENSE_OPENJPEG",
    "LICENSE_PDFJS_OPENJPEG",
    "LICENSE_QCMS",
    "LICENSE_PDFJS_QCMS",
  ],
  iccs: ["CGATS001Compat-v2-micro.icc", "LICENSE"],
};
const parent = path.resolve(root, "apps/web/public/vendor/pdfjs");
const target = path.resolve(parent, version);
if (
  path.dirname(target) !== parent ||
  !target.startsWith(path.resolve(root) + path.sep)
)
  throw new Error("Unsafe asset target.");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const files = [];
for (const [directory, names] of Object.entries(groups)) {
  await mkdir(path.join(target, directory), { recursive: true });
  for (const name of names.sort()) {
    const bytes = await readFile(path.join(source, directory, name));
    await copyFile(
      path.join(source, directory, name),
      path.join(target, directory, name),
    );
    files.push({
      path: `${directory}/${name}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
await copyFile(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
// Deliberate, reviewed OFL replacement; never read Liberation files from PDF.js.
const fontSource = path.resolve(
  root,
  "packages/pdf-browser/assets/liberation-sans/2.1.5",
);
const provenance = JSON.parse(
  await readFile(path.join(fontSource, "provenance.json"), "utf8"),
);
if (
  provenance.version !== "2.1.5" ||
  provenance.license !== "OFL-1.1" ||
  provenance.modified !== false ||
  provenance.files.length !== 5
)
  throw new Error("Review the Liberation font provenance.");
for (const file of provenance.files) {
  if (
    !/^(LiberationSans-(Regular|Bold|Italic|BoldItalic)\.ttf|LICENSE)$/.test(
      file.file,
    )
  )
    throw new Error("Unexpected alternative font asset.");
  const bytes = await readFile(path.join(fontSource, file.file));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new Error("Alternative font asset hash mismatch.");
  const name = file.file === "LICENSE" ? "LICENSE_LIBERATION_OFL" : file.file;
  await copyFile(
    path.join(fontSource, file.file),
    path.join(target, "standard_fonts", name),
  );
  files.push({
    path: `standard_fonts/${name}`,
    bytes: bytes.length,
    sha256: file.sha256,
    source: "Liberation Sans 2.1.5 OFL-1.1",
  });
}
await writeFile(
  path.join(target, "manifest.json"),
  JSON.stringify(
    {
      version,
      excluded: [
        "pdfjs-dist/standard_fonts/LiberationSans-*.ttf (bundled GPL version)",
        "pdfjs-dist/standard_fonts/LICENSE_LIBERATION",
        "quickjs-*",
        "web/*",
        "legacy/*",
      ],
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${files.length} reviewed assets (${version}); OFL Sans 2.1.5 supplied separately; bundled GPL fonts excluded.`,
);
