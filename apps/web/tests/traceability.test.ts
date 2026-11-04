import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GROUP_SIZES,
  STATUSES,
  TABLE_PATH,
  checkTraceability,
  idsIn,
  parseTable,
} from "../../../scripts/check-traceability.mjs";

// M7I. scripts/check-traceability.mjs keeps docs/qa/requirements-traceability.md
// true. The first test runs it on the real repository. The rest feed it small
// tables and files, so each rule is shown to fail when it should.

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const TEST_FILE = "apps/web/tests/example.test.ts";

interface RowSpec {
  status?: string;
  evidence?: string[];
  note?: string;
}

const allIds = Object.entries(GROUP_SIZES).flatMap(([group, size]) =>
  Array.from(
    { length: size },
    (_, index) => `${group}-${String(index + 1).padStart(3, "0")}`,
  ),
);

function tableOf(overrides: Record<string, RowSpec> = {}, drop: string[] = []) {
  const rows = allIds
    .filter((id) => !drop.includes(id))
    .map((id) => {
      const spec = overrides[id] ?? {};
      const status = spec.status ?? "Automated";
      const evidence = spec.evidence ?? [TEST_FILE];
      const cell = evidence.length
        ? evidence.map((file) => `\`${file}\``).join("<br>")
        : "none";
      return {
        id,
        status,
        line: `| ${id} | text | ${status} | ${cell} | ${spec.note ?? "-"} |`,
      };
    });
  const count = (status: string) =>
    rows.filter((row) => row.status === status).length;
  const totals = `${STATUSES.map((status) => `${status} ${count(status)}`).join(", ")} (${rows.length} in all)`;
  return [
    "# Table",
    `**Totals:** ${totals}`,
    "| ID | Requirement | Status | Evidence | Note |",
    ...rows.map((row) => row.line),
  ].join("\n");
}

const check = (
  markdown: string,
  files: Array<{ path: string; text: string }> = [],
  options: { strict?: boolean; missing?: string[] } = {},
) =>
  checkTraceability({
    markdown,
    files,
    exists: (file: string) => !(options.missing ?? []).includes(file),
    strict: options.strict,
  });

describe("the real table", () => {
  it("agrees with the repository", () => {
    const run = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/check-traceability.mjs")],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/\(102 in all\)/);
  });
});

describe("idsIn", () => {
  it.each([
    ["FR-MRG-001", ["FR-MRG-001"]],
    ["FR-MRG-001/004", ["FR-MRG-001", "FR-MRG-004"]],
    ["FR-META-001/004/006", ["FR-META-001", "FR-META-004", "FR-META-006"]],
    ["FR-CMP-001..003", ["FR-CMP-001", "FR-CMP-002", "FR-CMP-003"]],
    ["NFR-A11Y-005 / UX-010", ["NFR-A11Y-005"]],
    ["FR-GEN-004 and FR-I2P-001", ["FR-GEN-004", "FR-I2P-001"]],
    ["NFR-SEC-001, 002", ["NFR-SEC-001", "NFR-SEC-002"]],
    ["no requirement here", []],
  ])("reads %s", (text, expected) => {
    expect(idsIn(text)).toEqual(expected);
  });
});

describe("parseTable", () => {
  it("reads a row's cells and the files it cites", () => {
    const { rows, problems } = parseTable(
      "| FR-GEN-001 | Needs no sign-in | Automated | `a/b.test.ts`<br>`c/d.spec.ts` | note |",
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        id: "FR-GEN-001",
        requirement: "Needs no sign-in",
        status: "Automated",
        evidence: ["a/b.test.ts", "c/d.spec.ts"],
        note: "note",
        line: 1,
      },
    ]);
  });

  it("treats none as no evidence and - as no note", () => {
    const { rows } = parseTable("| FR-GEN-007 | x | Gap | none | - |");
    expect(rows[0]).toMatchObject({ evidence: [], note: "" });
  });

  it("reports a row with the wrong number of columns", () => {
    const { problems } = parseTable("| FR-GEN-001 | x | Automated |");
    expect(problems).toEqual([
      `${TABLE_PATH}:1: FR-GEN-001 has 3 columns, not 5`,
    ]);
  });
});

describe("checkTraceability", () => {
  it("accepts a complete, consistent table", () => {
    expect(check(tableOf()).problems).toEqual([]);
  });

  it("matches the 102 requirements of the SRS", () => {
    expect(allIds).toHaveLength(102);
  });

  it("fails when a requirement has no row", () => {
    const { problems } = check(tableOf({}, ["NFR-OBS-005"]));
    expect(problems).toContain(`${TABLE_PATH}: NFR-OBS-005 has no row`);
  });

  it("fails on a requirement the SRS does not have", () => {
    const markdown =
      tableOf() +
      `\n| FR-META-004 | invented | Automated | \`${TEST_FILE}\` | - |`;
    const { problems } = check(markdown);
    expect(
      problems.some((p) => p.includes("FR-META-004 is not a requirement")),
    ).toBe(true);
  });

  it("fails on a status that is not one of the five", () => {
    const { problems } = check(tableOf({ "FR-GEN-001": { status: "Done" } }));
    expect(problems.some((p) => p.includes('status "Done"'))).toBe(true);
  });

  it("fails when a cited file does not exist", () => {
    const { problems } = check(tableOf(), [], { missing: [TEST_FILE] });
    expect(
      problems.some((p) =>
        p.includes(`cites ${TEST_FILE}, which does not exist`),
      ),
    ).toBe(true);
  });

  it("does not let documents stand in for a test on an Automated row", () => {
    const { problems } = check(
      tableOf({ "FR-GEN-001": { evidence: ["docs/adr/README.md"] } }),
    );
    expect(
      problems.some((p) =>
        p.includes("FR-GEN-001 is Automated but cites no test"),
      ),
    ).toBe(true);
  });

  it("requires a note where something is missing", () => {
    const { problems } = check(
      tableOf({ "FR-GEN-005": { status: "Partial" } }),
    );
    expect(
      problems.some((p) => p.includes("FR-GEN-005 is Partial and must say")),
    ).toBe(true);
  });

  it("keeps a Gap free of evidence", () => {
    const { problems } = check(
      tableOf({ "FR-GEN-007": { status: "Gap", note: "none yet" } }),
    );
    expect(
      problems.some((p) =>
        p.includes("FR-GEN-007 is a Gap, so it cannot cite"),
      ),
    ).toBe(true);
  });

  it("names the owner of a deferred requirement", () => {
    const { problems } = check(
      tableOf({
        "NFR-ADS-001": { status: "Deferred", evidence: [], note: "later" },
      }),
    );
    expect(problems.some((p) => p.includes("NFR-ADS-001 is Deferred"))).toBe(
      true,
    );
    expect(
      check(
        tableOf({
          "NFR-ADS-001": {
            status: "Deferred",
            evidence: [],
            note: "M9. No ads yet.",
          },
        }),
      ).problems,
    ).toEqual([]);
  });

  it("fails when an ID written in a file is not a requirement", () => {
    const { problems } = check(tableOf(), [
      {
        path: "apps/web/e2e/x.spec.ts",
        text: 'test("NFR-UX-010: a title", () => {})',
      },
    ]);
    expect(problems).toEqual([
      "apps/web/e2e/x.spec.ts:1: NFR-UX-010 is not a requirement in the SRS",
    ]);
  });

  it("reads shorthand in a file, so a wrong ID after a slash is found", () => {
    const { problems } = check(tableOf(), [
      { path: "docs/adr/x.md", text: "FR-META-001/004" },
    ]);
    expect(problems).toEqual([
      "docs/adr/x.md:1: FR-META-004 is not a requirement in the SRS",
    ]);
  });

  it("requires a test that names a requirement to be listed on its row", () => {
    const { problems } = check(tableOf(), [
      { path: "apps/web/tests/other.test.ts", text: "it('FR-GEN-002: x')" },
    ]);
    expect(problems).toEqual([
      `apps/web/tests/other.test.ts:1: cites FR-GEN-002, but ${TABLE_PATH} does not list this file on that row`,
    ]);
  });

  it("does not let a test cite a requirement the table calls a Gap or Deferred", () => {
    const markdown = tableOf({
      "FR-GEN-007": { status: "Gap", evidence: [], note: "no test" },
    });
    const { problems } = check(markdown, [
      { path: TEST_FILE, text: "it('FR-GEN-007: x')" },
    ]);
    expect(
      problems.some((p) =>
        p.includes("cites FR-GEN-007, which the table calls Gap"),
      ),
    ).toBe(true);
  });

  it("lets other files name any real requirement", () => {
    expect(
      check(tableOf(), [
        { path: "docs/adr/x.md", text: "relates to FR-GEN-002" },
      ]).problems,
    ).toEqual([]);
  });

  it("fails when the totals line is wrong or missing", () => {
    const wrong = tableOf().replace(/Automated \d+/, "Automated 1");
    expect(
      check(wrong).problems.some((p) =>
        p.includes("the totals line should read"),
      ),
    ).toBe(true);
    const missing = tableOf().replace(/\*\*Totals:\*\*.*\n/, "");
    expect(
      check(missing).problems.some((p) =>
        p.includes("the totals line should read"),
      ),
    ).toBe(true);
  });

  it("in strict mode also fails on every Gap and every requirement deferred to M8", () => {
    const markdown = tableOf({
      "FR-GEN-007": { status: "Gap", evidence: [], note: "no test" },
      "NFR-OBS-001": {
        status: "Deferred",
        evidence: [],
        note: "M8. Not built.",
      },
      "NFR-ADS-001": {
        status: "Deferred",
        evidence: [],
        note: "M9. Not built.",
      },
    });
    expect(check(markdown).problems).toEqual([]);
    expect(check(markdown, [], { strict: true }).problems).toEqual([
      "launch gate: FR-GEN-007 is a Gap",
      "launch gate: NFR-OBS-001 is deferred to M8",
    ]);
  });
});
