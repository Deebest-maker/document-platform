import type { Metadata } from "next";
import { getRelatedTools, getTool } from "@document-platform/tool-registry";
import { SelectionExportWorkspace } from "../../components/page-tools/selection-export-workspace";
import { ToolList } from "../../components/tool-list";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("delete-pdf-pages");
if (!tool?.limits)
  throw new Error("Delete PDF Pages requires registry-backed limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function DeletePdfPagesPage() {
  return (
    <SelectionExportWorkspace
      tool={tool!}
      mode="delete"
      related={
        <>
          <h2>Related tools</h2>
          <ToolList records={getRelatedTools(tool!)} />
        </>
      }
    />
  );
}
