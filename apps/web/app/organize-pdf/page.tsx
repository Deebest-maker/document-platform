import type { Metadata } from "next";
import { getTool } from "@document-platform/tool-registry";
import { ToolGuide } from "../../components/tool-guide";
import { OrganizeWorkspace } from "../../components/organize/organize-workspace";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("organize-pdf");
if (!tool?.limits)
  throw new Error("Organize PDF requires registry-backed limits.");

export const metadata: Metadata = toolMetadata(tool);

export default function OrganizePdfPage() {
  return (
    <OrganizeWorkspace tool={tool!} related={<ToolGuide tool={tool!} />} />
  );
}
