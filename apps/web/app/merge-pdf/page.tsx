import type { Metadata } from "next";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { ToolList } from "../../components/tool-list";
import { MergeWorkspace } from "../../components/merge/merge-workspace";

const tool = getTool("merge-pdf");
if (!tool?.limits)
  throw new Error("Merge requires its registry configuration.");
export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};
export default function MergePage() {
  return (
    <MergeWorkspace
      tool={tool!}
      related={
        <>
          <h2>Related planned tools</h2>
          <ToolList records={getRelatedTools(tool!)} />
        </>
      }
    />
  );
}
