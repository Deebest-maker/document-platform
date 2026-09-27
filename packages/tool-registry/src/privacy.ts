import type { PageAvailability, ProcessingMode } from "./catalog";

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

export function getPrivacyPresentation(
  mode: ProcessingMode,
  availability: PageAvailability = "planned",
) {
  if (mode === "LOCAL" && availability === "available")
    return {
      label: "Processed on your device",
      explanation:
        "Your documents are processed in this browser. Document bytes are never uploaded to our servers or third parties. Start over or leave this page to release this session's files and result.",
    };
  return privacy[mode];
}
