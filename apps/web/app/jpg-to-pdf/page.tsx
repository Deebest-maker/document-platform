import type { Metadata } from "next";
import type { ImageLimits } from "@document-platform/pdf-browser/image-types";
import { getTool } from "@document-platform/tool-registry";
import { ImagesToPdfWorkspace } from "../../components/images-to-pdf/images-to-pdf-workspace";
import { ToolGuide } from "../../components/tool-guide";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("jpg-to-pdf");
const configured = tool?.limits;
if (
  !tool ||
  !configured?.maxWidth ||
  !configured.maxHeight ||
  !configured.maxPixelsPerImage ||
  !configured.maxAggregatePixels ||
  !configured.maxDecodedBytesPerImage ||
  !configured.maxAggregateDecodedBytes
)
  throw new Error("Images to PDF requires registry-backed image limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function ImagesToPdfPage() {
  return (
    <ImagesToPdfWorkspace
      tool={tool!}
      limits={configured as ImageLimits}
      related={<ToolGuide tool={tool!} />}
    />
  );
}
