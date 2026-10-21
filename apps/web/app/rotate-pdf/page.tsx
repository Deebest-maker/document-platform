import type { Metadata } from "next";
import { getRelatedTools, getTool } from "@document-platform/tool-registry";
import { RotateWorkspace } from "../../components/page-tools/rotate-workspace";
import { ToolList } from "../../components/tool-list";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("rotate-pdf");
if (!tool?.limits)
  throw new Error("Rotate PDF requires registry-backed limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function RotatePdfPage() {
  return (
    <RotateWorkspace
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
