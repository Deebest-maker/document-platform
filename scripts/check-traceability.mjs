#!/usr/bin/env node
// Checks docs/qa/requirements-traceability.md (M7I; document 08 section 12).
//
// The table maps every requirement in the SRS (document 03) to the tests or
// documented checks that cover it. This script keeps it honest:
//   - every row is well formed, and every file a row cites exists;
//   - the table has exactly the requirements the SRS has (group sizes are
//     pinned below, so a row cannot be dropped or invented quietly);
//   - a requirement ID written anywhere in the repository (a test title, a
//     comment, an ADR) must be a real one, with "FR-XXX-001/002" and
//     "FR-XXX-001..004" read as several IDs;
//   - a test that names a requirement must be listed on that requirement's row,
//     and that row cannot say "Gap" or "Deferred";
//   - the totals line in the document matches the rows.
// With --strict it also fails on the rows that would block a launch: every
// "Gap", and every "Deferred" that belongs to M8. Run it before the M8 gate.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TABLE_PATH = "docs/qa/requirements-traceability.md";

// Rows per group in document 03 (58 functional + 44 non-functional). Change
// these only when the SRS changes.
export const GROUP_SIZES = {
  "FR-GEN": 11,
  "FR-MRG": 4,
  "FR-CMP": 4,
  "FR-SPL": 4,
  "FR-I2P": 4,
  "FR-P2I": 3,
  "FR-P2W": 4,
  "FR-W2P": 3,
  "FR-ORG": 2,
  "FR-EXT": 1,
  "FR-DEL": 1,
  "FR-ROT": 2,
  "FR-META": 3,
  "FR-TXT": 4,
  "FR-PRV": 8,
  "NFR-SEC": 10,
  "NFR-PERF": 7,
  "NFR-REL": 5,
  "NFR-A11Y": 6,
  "NFR-SEO": 6,
  "NFR-ADS": 5,
  "NFR-OBS": 5,
};

export const STATUSES = ["Automated", "Partial", "Manual", "Gap", "Deferred"];

// What counts as a test (or the pipeline that runs them) for an "Automated" row.
const TEST_EVIDENCE =
  /(^|\/)(test_[^/]+\.py|[^/]+\.(test|spec)\.(ts|tsx)|fixtures\.ts)$|^\.github\/workflows\/[^/]+\.yml$/;
// Files that are tests, whose citations must be listed in the table.
const TEST_FILE = /(^|\/)(test_[^/]+\.py|[^/]+\.(test|spec)\.(ts|tsx))$/;
const DEFERRED_OWNER = /^(M8|M9|V1\.1)\b/;
const SCANNED = /\.(ts|tsx|mts|mjs|js|py|md|yml)$/;
// These write example IDs on purpose.
const SELF = new Set([
  TABLE_PATH,
  "scripts/check-traceability.mjs",
  "apps/web/tests/traceability.test.ts",
]);

const ID = /\b(N?FR)-([A-Z0-9]+)-(\d{3})((?:\s*(?:\/|,|\.\.)\s*\d{3})*)/g;

/** Every requirement ID in a line of text, with "001/002" and "001..004" expanded. */
export function idsIn(line) {
  const found = [];
  for (const match of line.matchAll(ID)) {
    const [, kind, group, first, rest] = match;
    const numbers = rest.match(/\d{3}/g) ?? [];
    let list = [first, ...numbers];
    if (rest.includes("..") && numbers.length > 0) {
      const from = Number(first);
      const to = Number(numbers.at(-1));
      list = [];
      for (let n = from; n <= to; n += 1) list.push(String(n).padStart(3, "0"));
    }
    for (const number of list) found.push(`${kind}-${group}-${number}`);
  }
  return found;
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

/** The rows of the table, and anything wrong with how they are written. */
export function parseTable(markdown) {
  const rows = [];
  const problems = [];
  markdown.split("\n").forEach((line, index) => {
    const start = line.match(/^\|\s*((?:N?FR)-[A-Z0-9]+-\d{3})\s*\|/);
    if (!start) return;
    const where = `${TABLE_PATH}:${index + 1}`;
    const parts = cells(line);
    if (parts.length !== 5) {
      problems.push(`${where}: ${start[1]} has ${parts.length} columns, not 5`);
      return;
    }
    const [id, requirement, status, evidenceCell, note] = parts;
    const evidence =
      evidenceCell === "none"
        ? []
        : [...evidenceCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    rows.push({
      id,
      requirement,
      status,
      evidence,
      note: note === "-" ? "" : note,
      line: index + 1,
    });
  });
  return { rows, problems };
}

function totalsLine(rows) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  return `${STATUSES.map((status) => `${status} ${count(status)}`).join(", ")} (${rows.length} in all)`;
}

/**
 * @param {{ markdown: string, files: Array<{path: string, text: string}>,
 *   exists: (path: string) => boolean, strict?: boolean }} input
 */
export function checkTraceability({ markdown, files, exists, strict = false }) {
  const { rows, problems } = parseTable(markdown);
  const byId = new Map();

  for (const row of rows) {
    const where = `${TABLE_PATH}:${row.line}`;
    if (byId.has(row.id)) problems.push(`${where}: ${row.id} appears twice`);
    byId.set(row.id, row);
    if (!STATUSES.includes(row.status))
      problems.push(
        `${where}: ${row.id} has status "${row.status}", not one of ${STATUSES.join(", ")}`,
      );
    if (!row.requirement)
      problems.push(`${where}: ${row.id} has no requirement text`);
    for (const file of row.evidence)
      if (!exists(file))
        problems.push(
          `${where}: ${row.id} cites ${file}, which does not exist`,
        );

    const hasTest = row.evidence.some((file) => TEST_EVIDENCE.test(file));
    if (row.status === "Automated" && !hasTest)
      problems.push(
        `${where}: ${row.id} is Automated but cites no test or workflow`,
      );
    if (
      (row.status === "Partial" || row.status === "Manual") &&
      row.evidence.length === 0
    )
      problems.push(`${where}: ${row.id} is ${row.status} but cites nothing`);
    if (row.status === "Gap" && row.evidence.length > 0)
      problems.push(
        `${where}: ${row.id} is a Gap, so it cannot cite evidence (move it to Partial)`,
      );
    if (["Partial", "Manual", "Gap"].includes(row.status) && !row.note)
      problems.push(
        `${where}: ${row.id} is ${row.status} and must say in the note what is missing or how it was checked`,
      );
    if (row.status === "Deferred" && !DEFERRED_OWNER.test(row.note))
      problems.push(
        `${where}: ${row.id} is Deferred, so its note must start with the milestone that owns it (M8, M9 or V1.1)`,
      );
  }

  // The table has the SRS's requirements: all of them, in order, and no others.
  for (const [group, size] of Object.entries(GROUP_SIZES)) {
    for (let n = 1; n <= size; n += 1) {
      const id = `${group}-${String(n).padStart(3, "0")}`;
      if (!byId.has(id)) problems.push(`${TABLE_PATH}: ${id} has no row`);
    }
  }
  for (const id of byId.keys()) {
    const [, group, number] = id.match(/^(.*)-(\d{3})$/);
    const size = GROUP_SIZES[group];
    if (size === undefined || Number(number) < 1 || Number(number) > size)
      problems.push(`${TABLE_PATH}: ${id} is not a requirement in the SRS`);
  }

  // A requirement ID anywhere in the repository must be real, and a test that
  // names one must be on its row.
  for (const { path: file, text } of files) {
    if (SELF.has(file)) continue;
    const isTest = TEST_FILE.test(file);
    text.split("\n").forEach((line, index) => {
      for (const id of new Set(idsIn(line))) {
        const where = `${file}:${index + 1}`;
        const row = byId.get(id);
        if (!row) {
          problems.push(`${where}: ${id} is not a requirement in the SRS`);
          continue;
        }
        if (!isTest) continue;
        if (!row.evidence.includes(file))
          problems.push(
            `${where}: cites ${id}, but ${TABLE_PATH} does not list this file on that row`,
          );
        if (row.status === "Gap" || row.status === "Deferred")
          problems.push(
            `${where}: cites ${id}, which the table calls ${row.status}`,
          );
      }
    });
  }

  // The totals in the document are the rows' totals.
  const expected = totalsLine(rows);
  const stated = markdown.match(/^\*\*Totals:\*\* (.+)$/m)?.[1];
  if (stated !== expected)
    problems.push(
      `${TABLE_PATH}: the totals line should read "**Totals:** ${expected}"${stated ? ` (it says "${stated}")` : ""}`,
    );

  if (strict) {
    for (const row of rows) {
      if (row.status === "Gap")
        problems.push(`launch gate: ${row.id} is a Gap`);
      if (row.status === "Deferred" && /^M8\b/.test(row.note))
        problems.push(`launch gate: ${row.id} is deferred to M8`);
    }
  }

  return { problems, rows, summary: totalsLine(rows) };
}

function trackedFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter((file) => file && SCANNED.test(file));
}

export function main(argv = process.argv.slice(2)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const markdown = readFileSync(path.join(root, TABLE_PATH), "utf8");
  const files = trackedFiles(root)
    .filter((file) => existsSync(path.join(root, file)))
    .map((file) => ({
      path: file,
      text: readFileSync(path.join(root, file), "utf8"),
    }));
  const { problems, summary } = checkTraceability({
    markdown,
    files,
    exists: (file) => existsSync(path.join(root, file)),
    strict: argv.includes("--strict"),
  });
  if (problems.length > 0) {
    console.error(`Requirement traceability: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(`Requirement traceability: ${summary}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main());
