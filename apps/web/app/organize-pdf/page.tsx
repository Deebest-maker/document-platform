import type { Metadata } from "next";
import { getRelatedTools, getTool } from "@document-platform/tool-registry";
import { ToolList } from "../../components/tool-list";
import { OrganizeWorkspace } from "../../components/organize/organize-workspace";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("organize-pdf");
if (!tool?.limits)
  throw new Error("Organize PDF requires registry-backed limits.");

export const metadata: Metadata = toolMetadata(tool);

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
