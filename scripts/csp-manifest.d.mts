export const MANIFEST_VERSION: 1;
export const MANIFEST_FILE: string;
export interface CspManifest {
  version: 1;
  routes: Record<string, string[]>;
  fallback: string[];
}
export function inlineScripts(html: string): string[];
export function scriptHashes(html: string): string[];
export const FRAMEWORK_ERROR_PAGE: string;
export function auditPage(
  html: string,
  options?: { inlineStyles?: boolean },
): string[];
export function buildManifest(distDirectory: string): {
  manifest: CspManifest;
  problems: string[];
};
export function writeManifest(distDirectory: string): {
  manifest: CspManifest;
  problems: string[];
};
