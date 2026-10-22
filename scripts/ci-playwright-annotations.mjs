// Turns a Playwright JSON report into GitHub annotations (one per browser
// project), so that a failed run says which tests failed and why on the
// check run itself. Reading the raw job log is not always possible; the
// annotations are part of the check run and are.
//
// Usage: node scripts/ci-playwright-annotations.mjs <results.json>
// Always exits 0: it reports, it does not decide the build result.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_MESSAGE_CHARS = 30_000;
const MAX_LINE_CHARS = 900;
const ERROR_LINES = 8;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function firstLines(text, count) {
  return String(text ?? "")
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .join(" | ");
}

/** Walks suites and returns every test whose final result was not a pass. */
export function collectFailures(report) {
  const failures = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "unexpected" && test.status !== "flaky") continue;
        const last = test.results?.[test.results.length - 1];
        const error = last?.error ?? last?.errors?.[0];
        failures.push({
          project: test.projectName ?? "unknown",
          kind: test.status === "flaky" ? "flaky" : "failed",
          file: spec.file ?? suite.file ?? "",
          line: spec.line ?? 0,
          title: spec.title,
          message: firstLines(error?.message, ERROR_LINES),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return failures;
}

const escapeData = (value) =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (value) =>
  escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** One `::error` workflow command per browser project. */
export function formatAnnotations(failures) {
  const byProject = new Map();
  for (const failure of failures) {
    const list = byProject.get(failure.project) ?? [];
    list.push(failure);
    byProject.set(failure.project, list);
  }
  const commands = [];
  for (const [project, list] of byProject) {
    let body = list
      .map((f) => {
        const line = `${f.kind === "flaky" ? "[flaky] " : ""}${f.file}:${f.line} ${f.title} -- ${f.message}`;
        return line.length > MAX_LINE_CHARS
          ? `${line.slice(0, MAX_LINE_CHARS - 3)}...`
          : line;
      })
      .join("\n");
    if (body.length > MAX_MESSAGE_CHARS) {
      body = `${body.slice(0, MAX_MESSAGE_CHARS)}\n... (truncated)`;
    }
    commands.push(
      `::error title=${escapeProperty(`Playwright ${project}: ${list.length} not passing`)}::${escapeData(body)}`,
    );
  }
  return commands;
}

function main() {
  const path = process.argv[2];
  if (!path || !existsSync(path)) {
    console.log(`::notice::No Playwright JSON report at ${path ?? "(none)"}`);
    return;
  }
  const report = JSON.parse(readFileSync(path, "utf8"));
  const failures = collectFailures(report);
  const {
    expected = 0,
    unexpected = 0,
    flaky = 0,
    skipped = 0,
  } = report.stats ?? {};
  console.log(
    `::notice::Playwright: ${expected} passed, ${unexpected} failed, ${flaky} flaky, ${skipped} skipped`,
  );
  for (const command of formatAnnotations(failures)) console.log(command);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
