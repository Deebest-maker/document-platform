export interface HeaderEntry {
  key: string;
  value: string;
}
export function hashSource(text: string): string;
export function documentPolicy(hashes: readonly string[]): string;
export const WORKER_POLICY: string;
export const PERMISSIONS_POLICY: string;
export const SECURITY_HEADERS: readonly HeaderEntry[];
