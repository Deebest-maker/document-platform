export const TABLE_PATH: string;
export const GROUP_SIZES: Record<string, number>;
export const STATUSES: string[];
export interface TraceRow {
  id: string;
  requirement: string;
  status: string;
  evidence: string[];
  note: string;
  line: number;
}
export function idsIn(line: string): string[];
export function parseTable(markdown: string): {
  rows: TraceRow[];
  problems: string[];
};
export function checkTraceability(input: {
  markdown: string;
  files: Array<{ path: string; text: string }>;
  exists: (path: string) => boolean;
  strict?: boolean;
}): { problems: string[]; rows: TraceRow[]; summary: string };
export function main(argv?: string[]): number;
