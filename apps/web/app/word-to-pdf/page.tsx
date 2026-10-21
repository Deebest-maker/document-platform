import type { Metadata } from "next";
import { getRelatedTools, getTool } from "@document-platform/tool-registry";
import { ToolList } from "../../components/tool-list";
import { WordToPdfWorkspace } from "../../components/word-to-pdf/word-to-pdf-workspace";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("word-to-pdf");
if (!tool?.limits)
  throw new Error("Word to PDF requires its registry configuration.");
export const metadata: Metadata = toolMetadata(tool);
export default function WordToPdfPage() {
  return (
    <WordToPdfWorkspace
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
