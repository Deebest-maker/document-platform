import type { PageErrorCode } from "./page-errors";

// Standard PDF Document Information dictionary field names, per ISO 32000-1
// §14.3.3 "Document information dictionary". The engine removes every entry
// listed here from the Info dictionary and verifies absence after reopening.
export const STANDARD_INFO_KEYS = [
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

export type StandardInfoKey = (typeof STANDARD_INFO_KEYS)[number];

export type MetadataPhase = "reading" | "removing" | "validating" | "verifying";

export interface MetadataRemovalOptions {
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: MetadataPhase) => void;
}

export interface MetadataRemovalLimits {
  readonly maxInputBytes: number;
  readonly maxPages: number;
  readonly maxOutputBytes: number;
}

// Snapshot of removable metadata observed on the source PDF, used for the
// before/after independent verification. All string values are reported as
// `kind: "present"` plus a boolean; raw values do NOT cross this boundary
// (they are document content that must not reach logs or analytics).
export interface MetadataSnapshotFlags {
  readonly standardInfoPresent: Readonly<Record<StandardInfoKey, boolean>>;
  readonly customInfoKeys: readonly string[];
  readonly xmpStreamPresent: boolean;
  readonly trailerIdPresent: boolean;
}

export interface MetadataRemovalResult {
  readonly blob: Blob;
  readonly bytes: number;
  readonly pageCount: number;
  readonly before: MetadataSnapshotFlags;
  readonly after: MetadataSnapshotFlags;
  readonly removed: {
    readonly standardInfo: readonly StandardInfoKey[];
    readonly customInfo: readonly string[];
    readonly xmpStream: boolean;
    readonly trailerId: boolean;
  };
  // Independent verification: every targeted field marked present in `before`
  // must be absent in `after`. Trailer /ID removal is best-effort (see
  // ADR-020); `trailerIdControllable` reports whether this build was able to
  // suppress /ID on save. The UI must not claim trailer /ID was removed when
  // this is false.
  readonly trailerIdControllable: boolean;
  readonly pagesPreserved: boolean;
  // Geometry comparison before/after — populated for every retained page.
  readonly pageGeometry: readonly {
    readonly sourcePageNumber: number;
    readonly beforeMediaBox: readonly number[];
    readonly afterMediaBox: readonly number[];
    readonly beforeRotation: number;
    readonly afterRotation: number;
    readonly geometryUnchanged: boolean;
    readonly rotationUnchanged: boolean;
  }[];
}

export type MetadataRemovalErrorCode = PageErrorCode;
