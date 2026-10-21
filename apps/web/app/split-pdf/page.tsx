import type { Metadata } from "next";
import { getTool } from "@document-platform/tool-registry";
import { SplitWorkspace } from "../../components/split/split-workspace";
import { ToolGuide } from "../../components/tool-guide";
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
  return <SplitWorkspace tool={tool!} related={<ToolGuide tool={tool!} />} />;
}
