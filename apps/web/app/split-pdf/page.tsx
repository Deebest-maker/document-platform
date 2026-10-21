import type { Metadata } from "next";
import { getRelatedTools, getTool } from "@document-platform/tool-registry";
import { SplitWorkspace } from "../../components/split/split-workspace";
import { ToolList } from "../../components/tool-list";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("split-pdf");
if (
  !tool?.limits?.maxOutputs ||
  !tool.limits.maxCombinedOutputBytes ||
  !tool.limits.maxArchiveBytes
)
  throw new Error("Split PDF requires registry-backed batch limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function SplitPdfPage() {
  return (
    <SplitWorkspace
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
