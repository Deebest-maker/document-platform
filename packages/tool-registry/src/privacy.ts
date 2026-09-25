import type { ProcessingMode } from "./catalog";

export const processingModes = [
  "LOCAL",
  "SERVER",
  "HYBRID",
] as const satisfies readonly ProcessingMode[];

const privacy: Record<ProcessingMode, { label: string; explanation: string }> =
  {
    LOCAL: {
      label: "Planned: processed on your device",
      explanation:
        "The planned operation will run in your browser without uploading document bytes to the processing service. This tool is not available yet.",
    },
    SERVER: {
      label: "Planned: server processing",
      explanation:
        "The planned operation will require a document upload. Upload, security and deletion details must be provided before this tool becomes available. No document can be uploaded here.",
    },
    HYBRID: {
      label: "Planned: processing location depends on the operation/options",
      explanation:
        "Some planned operations may run in your browser; others will require an upload. The processing location must be explained before you commit to an operation. This tool is not available yet.",
    },
  };

// M1 only has unavailable tools. Live-tool wording requires a reviewed change.
export function getPrivacyPresentation(mode: ProcessingMode) {
  return privacy[mode];
}
