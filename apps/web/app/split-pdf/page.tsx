import type { Metadata } from "next";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { SplitWorkspace } from "../../components/split/split-workspace";
import { ToolList } from "../../components/tool-list";

const tool = getTool("split-pdf");
if (
  !tool?.limits?.maxOutputs ||
  !tool.limits.maxCombinedOutputBytes ||
  !tool.limits.maxArchiveBytes
)
  throw new Error("Split PDF requires registry-backed batch limits.");

export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};

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
