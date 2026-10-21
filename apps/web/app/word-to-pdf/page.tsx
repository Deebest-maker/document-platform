import type { Metadata } from "next";
import { getTool } from "@document-platform/tool-registry";
import { ToolGuide } from "../../components/tool-guide";
import { WordToPdfWorkspace } from "../../components/word-to-pdf/word-to-pdf-workspace";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("word-to-pdf");
if (!tool?.limits)
  throw new Error("Word to PDF requires its registry configuration.");
export const metadata: Metadata = toolMetadata(tool);
export default function WordToPdfPage() {
  return (
    <WordToPdfWorkspace tool={tool!} related={<ToolGuide tool={tool!} />} />
  );
}
