import type { Metadata } from "next";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { ToolList } from "../../components/tool-list";
import { OrganizeWorkspace } from "../../components/organize/organize-workspace";

const tool = getTool("organize-pdf");
if (!tool?.limits)
  throw new Error("Organize PDF requires registry-backed limits.");

export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};

export default function OrganizePdfPage() {
  return (
    <OrganizeWorkspace
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
