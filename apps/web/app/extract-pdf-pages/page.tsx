import type { Metadata } from "next";
import { getTool } from "@document-platform/tool-registry";
import { SelectionExportWorkspace } from "../../components/page-tools/selection-export-workspace";
import { ToolGuide } from "../../components/tool-guide";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("extract-pdf-pages");
if (!tool?.limits)
  throw new Error("Extract PDF Pages requires registry-backed limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function ExtractPdfPagesPage() {
  return (
    <SelectionExportWorkspace
      tool={tool!}
      mode="extract"
      related={<ToolGuide tool={tool!} />}
    />
  );
}
