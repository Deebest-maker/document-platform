import type { Metadata } from "next";
import type { PdfToJpegLimits } from "@document-platform/pdf-browser/pdf-to-jpg";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { PdfToJpgWorkspace } from "../../components/pdf-to-jpg/pdf-to-jpg-workspace";
import { ToolList } from "../../components/tool-list";

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

export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};

export default function PdfToJpgPage() {
  return (
    <PdfToJpgWorkspace
      tool={tool!}
      limits={configured as PdfToJpegLimits}
      related={
        <>
          <h2>Related tools</h2>
          <ToolList records={getRelatedTools(tool!)} />
        </>
      }
    />
  );
}
