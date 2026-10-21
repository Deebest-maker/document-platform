import type { Metadata } from "next";
import type { PdfToJpegLimits } from "@document-platform/pdf-browser/pdf-to-jpg";
import { getTool } from "@document-platform/tool-registry";
import { PdfToJpgWorkspace } from "../../components/pdf-to-jpg/pdf-to-jpg-workspace";
import { ToolGuide } from "../../components/tool-guide";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("pdf-to-jpg");
const configured = tool?.limits;
if (
  !tool ||
  !configured?.maxSelectedPages ||
  !configured.maxPixelsPerPage ||
  !configured.maxAggregatePixels ||
  !configured.maxCanvasBytes ||
  !configured.maxCombinedOutputBytes ||
  !configured.maxArchiveBytes
)
  throw new Error("PDF to JPG requires registry-backed raster limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function PdfToJpgPage() {
  return (
    <PdfToJpgWorkspace
      tool={tool!}
      limits={configured as PdfToJpegLimits}
      related={<ToolGuide tool={tool!} />}
    />
  );
}
