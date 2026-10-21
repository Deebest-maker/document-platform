import type { Metadata } from "next";
import { getTool } from "@document-platform/tool-registry";
import { RotateWorkspace } from "../../components/page-tools/rotate-workspace";
import { ToolGuide } from "../../components/tool-guide";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("rotate-pdf");
if (!tool?.limits)
  throw new Error("Rotate PDF requires registry-backed limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function RotatePdfPage() {
  return <RotateWorkspace tool={tool!} related={<ToolGuide tool={tool!} />} />;
}
