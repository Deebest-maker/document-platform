import type { Metadata } from "next";
import type { ImageLimits } from "@document-platform/pdf-browser/image-types";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { ImagesToPdfWorkspace } from "../../components/images-to-pdf/images-to-pdf-workspace";
import { ToolList } from "../../components/tool-list";

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

export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};

export default function ImagesToPdfPage() {
  return (
    <ImagesToPdfWorkspace
      tool={tool!}
      limits={configured as ImageLimits}
      related={
        <>
          <h2>Related tools</h2>
          <ToolList records={getRelatedTools(tool!)} />
        </>
      }
    />
  );
}
