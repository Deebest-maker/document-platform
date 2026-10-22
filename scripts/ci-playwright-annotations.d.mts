export interface PlaywrightFailure {
  project: string;
  kind: "failed" | "flaky";
  file: string;
  line: number;
  title: string;
  message: string;
}
export function collectFailures(report: unknown): PlaywrightFailure[];
export function formatAnnotations(failures: PlaywrightFailure[]): string[];
