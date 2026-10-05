import type { Metadata } from "next";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { SelectionExportWorkspace } from "../../components/page-tools/selection-export-workspace";
import { ToolList } from "../../components/tool-list";

const tool = getTool("delete-pdf-pages");
if (!tool?.limits)
  throw new Error("Delete PDF Pages requires registry-backed limits.");

export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};

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
