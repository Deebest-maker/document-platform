import type { Metadata } from "next";
import type { CompressLimits } from "@document-platform/pdf-browser/compress";
import { DEFAULT_COMPRESS_LIMITS } from "@document-platform/pdf-browser/compress";
import { getRelatedTools, getTool } from "@document-platform/tool-registry";
import { CompressPdfWorkspace } from "../../components/compress-pdf/compress-pdf-workspace";
import { ToolList } from "../../components/tool-list";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("compress-pdf");
const configured = tool?.limits;
if (
  !tool ||
  !configured?.maxFileBytes ||
  !configured.maxPages ||
  !configured.maxOutputBytes ||
  !configured.maxPixelsPerImage
)
  throw new Error("Compress PDF requires registry-backed engineering limits.");

// User-visible limits come from the registry; the remaining safety valves are
// the engine's tested defaults (ADR-025).
const limits: CompressLimits = {
  ...DEFAULT_COMPRESS_LIMITS,
  maxInputBytes: configured.maxFileBytes,
  maxPages: configured.maxPages,
  maxOutputBytes: configured.maxOutputBytes,
  maxJpegPixels: configured.maxPixelsPerImage,
};

export const metadata: Metadata = toolMetadata(tool);

export default function CompressPdfPage() {
  return (
    <CompressPdfWorkspace
      tool={tool!}
      limits={limits}
      related={
        <>
          <h2>Related tools</h2>
          <ToolList records={getRelatedTools(tool!)} />
        </>
      }
    />
  );
}
