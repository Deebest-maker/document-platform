/**
 * Site-wide availability wording, derived from the tool registry (M6B.1).
 *
 * Tool counts and the "which tools use our server" sentence used to be typed
 * into several pages by hand. They drifted: the Tools page kept saying
 * "Eleven tools are available" after Word to PDF made it twelve, and the
 * Privacy page said every available tool runs in the browser. Pages now read
 * these values from the registry, and tests compare the rendered copy with it.
 */

import {
  tools,
  type PageAvailability,
  type ProcessingMode,
  type ToolDefinition,
} from "@document-platform/tool-registry";

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
] as const;

/** Lower-case number word up to twenty, digits beyond. */
export function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

export function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "A, B and C": the site's copy does not use the serial comma. */
export function listTitles(items: readonly string[]) {
  return new Intl.ListFormat("en-GB", {
    style: "long",
    type: "conjunction",
  }).format(items);
}

/** Titles of the available tools that use this processing mode, in catalog order. */
export function getAvailableTitles(
  mode: ProcessingMode,
  records: readonly ToolDefinition[] = tools,
): readonly string[] {
  return records
    .filter(
      (tool) =>
        tool.availability === "available" && tool.processingMode === mode,
    )
    .map((tool) => tool.title);
}

export interface AvailabilitySummary {
  /** Tools that can process files now, in the browser or on our server. */
  readonly available: number;
  /** Available tools that never upload documents. */
  readonly local: number;
  /** Available tools that upload the document to our server. */
  readonly server: number;
  /** Everything that cannot process files yet. */
  readonly planned: number;
  readonly serverTitles: readonly string[];
}

export function getAvailabilitySummary(
  records: readonly ToolDefinition[] = tools,
): AvailabilitySummary {
  const available = records.filter((tool) => tool.availability === "available");
  const local = available.filter((tool) => tool.processingMode === "LOCAL");
  const server = available.filter((tool) => tool.processingMode === "SERVER");
  return {
    available: available.length,
    local: local.length,
    server: server.length,
    planned: records.length - available.length,
    serverTitles: server.map((tool) => tool.title),
  };
}

const toolNoun = (count: number) => (count === 1 ? "tool" : "tools");

/**
 * Whether any tool using this processing mode can process files now. Used so
 * the explanation of a mode is labelled "Planned" only while it is planned.
 */
export function getModeAvailability(
  mode: ProcessingMode,
  records: readonly ToolDefinition[] = tools,
): PageAvailability {
  return records.some(
    (tool) => tool.availability === "available" && tool.processingMode === mode,
  )
    ? "available"
    : "planned";
}

/** "Eleven tools work on your device. Word to PDF uses our server. …" */
export function availabilityStatus(summary = getAvailabilitySummary()) {
  const sentences = [
    `${capitalise(countWord(summary.local))} ${toolNoun(summary.local)} ${
      summary.local === 1 ? "works" : "work"
    } on your device.`,
  ];
  if (summary.server > 0)
    sentences.push(
      `${listTitles(summary.serverTitles)} ${summary.server === 1 ? "uses" : "use"} our server.`,
    );
  if (summary.planned > 0)
    sentences.push(
      summary.planned === 1
        ? `${summary.available > 0 ? "Another" : "The"} tool is planned.`
        : `${summary.available > 0 ? "Other" : "The"} tools are planned.`,
    );
  return sentences.join(" ");
}

/**
 * "Twelve tools are available: eleven work on your device and Word to PDF
 * uploads your file to our server." The planned remainder is a separate
 * sentence, see {@link plannedRemainder}.
 */
export function availabilityBreakdown(summary = getAvailabilitySummary()) {
  const local = `${countWord(summary.local)} ${summary.local === 1 ? "works" : "work"} on your device`;
  const server =
    summary.server > 0
      ? ` and ${listTitles(summary.serverTitles)} ${
          summary.server === 1 ? "uploads your file" : "upload your files"
        } to our server`
      : "";
  return `${capitalise(countWord(summary.available))} ${toolNoun(summary.available)} ${
    summary.available === 1 ? "is" : "are"
  } available: ${local}${server}.`;
}

/** "The remaining tool is planned and cannot process documents yet." */
export function plannedRemainder(summary = getAvailabilitySummary()) {
  if (summary.planned === 0) return "";
  return `The remaining ${toolNoun(summary.planned)} ${
    summary.planned === 1 ? "is" : "are"
  } planned and cannot process documents yet.`;
}
