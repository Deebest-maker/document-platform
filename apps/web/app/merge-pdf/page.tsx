import type { Metadata } from "next";
import { getRelatedTools, getTool } from "@document-platform/tool-registry";
import { ToolList } from "../../components/tool-list";
import { MergeWorkspace } from "../../components/merge/merge-workspace";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("merge-pdf");
if (!tool?.limits)
  throw new Error("Merge requires its registry configuration.");
export const metadata: Metadata = toolMetadata(tool);
export default function MergePage() {
  return (
    <MergeWorkspace
      tool={tool!}
      related={
        <>
          <h2>Related tools</h2>
          <ToolList records={getRelatedTools(tool!)} />
        </>
      }
    />
  );
}
