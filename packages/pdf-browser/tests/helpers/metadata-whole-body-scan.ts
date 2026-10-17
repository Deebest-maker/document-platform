// Whole-body byte-level scanner for Remove PDF Metadata output.
//
// This file is TEST AND BENCHMARK only. It is NOT re-exported from the
// `./metadata-removal` subpath and NOT reachable from the engine. The
// scanner walks the whole Latin-1-decoded body and reports whether
// metadata-shaped tokens appear anywhere; because a global regex can
// false-positive on legitimately-placed byte sequences (a `/Title` key
// inside an unrelated name tree, say), the result is a signal for human
// review, not a correctness gate. Tests use it to flag suspicious output
// so a human can look at it; the production publication gate is pdf-lib's
// structurally scoped reopen snapshot, which looks at the specific PDF
// object the field lives in.

export const STANDARD_INFO_KEY_NAMES = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
  "Trapped",
] as const;

export type StandardInfoKeyName = (typeof STANDARD_INFO_KEY_NAMES)[number];

export interface WholeBodyScanInput {
  readonly bytes: Uint8Array;
  readonly customInfoKeys?: readonly string[];
  readonly preservationCanaries?: readonly string[];
  readonly removalCanaries?: readonly string[];
}

export interface WholeBodyScanResult {
  readonly hasPdfHeader: boolean;
  readonly standardInfoNamesPresent: Readonly<
    Record<StandardInfoKeyName, boolean>
  >;
  readonly customInfoNamesPresent: Readonly<Record<string, boolean>>;
  readonly xmpStreamHeaderPresent: boolean;
  readonly trailerIdPresent: boolean;
  readonly trailerIdPatternMatched: boolean;
  readonly removalCanariesFound: readonly string[];
  readonly preservationCanariesFound: readonly string[];
  readonly preservationCanariesMissing: readonly string[];
  readonly ok: boolean;
}

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++)
    if (bytes[i] !== prefix[i]) return false;
  return true;
}

function toLatin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x10000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(bytes.length, i + chunk);
    const slice = bytes.subarray(i, end);
    out += String.fromCharCode(...slice);
  }
  return out;
}

function infoKeyPattern(name: string): RegExp {
  const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`/${escaped}(?=[\\s/<\\[(])`, "g");
}

const TRAILER_ID_PATTERN = /\/ID\s*\[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]/;
const XMP_STREAM_PATTERN = /<\?xpacket[\s\S]*?\?>|<x:xmpmeta\b/;

function containsLiteral(latin1: string, needle: string): boolean {
  if (!needle) return false;
  return latin1.indexOf(needle) !== -1;
}

export function scanWholeBody(input: WholeBodyScanInput): WholeBodyScanResult {
  const { bytes } = input;
  const customInfoKeys = input.customInfoKeys ?? [];
  const preservationCanaries = input.preservationCanaries ?? [];
  const removalCanaries = input.removalCanaries ?? [];

  const hasPdfHeader = startsWith(bytes, PDF_HEADER);
  const latin1 = toLatin1(bytes);

  const standardFlags: Record<string, boolean> = {};
  for (const name of STANDARD_INFO_KEY_NAMES) {
    standardFlags[name] = infoKeyPattern(name).test(latin1);
  }

  const customFlags: Record<string, boolean> = {};
  for (const name of customInfoKeys) {
    customFlags[name] = infoKeyPattern(name).test(latin1);
  }

  const xmpStreamHeaderPresent = XMP_STREAM_PATTERN.test(latin1);
  const trailerIdPatternMatched = TRAILER_ID_PATTERN.test(latin1);
  const looseTrailerId =
    trailerIdPatternMatched || /\/ID\s*\[\s*<[0-9A-Fa-f]+>/.test(latin1);
  const trailerIdPresent = looseTrailerId;

  const removalCanariesFound = removalCanaries.filter((canary) =>
    containsLiteral(latin1, canary),
  );
  const preservationCanariesFound = preservationCanaries.filter((canary) =>
    containsLiteral(latin1, canary),
  );
  const preservationCanariesMissing = preservationCanaries.filter(
    (canary) => !containsLiteral(latin1, canary),
  );

  const anyStandardPresent = Object.values(standardFlags).some(Boolean);
  const anyCustomPresent = Object.values(customFlags).some(Boolean);

  const ok =
    hasPdfHeader &&
    !anyStandardPresent &&
    !anyCustomPresent &&
    !xmpStreamHeaderPresent &&
    removalCanariesFound.length === 0 &&
    preservationCanariesMissing.length === 0;

  return Object.freeze({
    hasPdfHeader,
    standardInfoNamesPresent: Object.freeze(standardFlags) as Readonly<
      Record<StandardInfoKeyName, boolean>
    >,
    customInfoNamesPresent: Object.freeze(customFlags),
    xmpStreamHeaderPresent,
    trailerIdPresent,
    trailerIdPatternMatched,
    removalCanariesFound: Object.freeze(removalCanariesFound),
    preservationCanariesFound: Object.freeze(preservationCanariesFound),
    preservationCanariesMissing: Object.freeze(preservationCanariesMissing),
    ok,
  });
}
