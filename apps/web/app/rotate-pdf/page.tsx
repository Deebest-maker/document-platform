import type { Metadata } from "next";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { RotateWorkspace } from "../../components/page-tools/rotate-workspace";
import { ToolList } from "../../components/tool-list";

const tool = getTool("rotate-pdf");
if (!tool?.limits)
  throw new Error("Rotate PDF requires registry-backed limits.");

export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};

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
