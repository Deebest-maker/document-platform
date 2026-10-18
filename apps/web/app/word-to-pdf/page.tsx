import type { Metadata } from "next";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { ToolList } from "../../components/tool-list";
import { WordToPdfWorkspace } from "../../components/word-to-pdf/word-to-pdf-workspace";

const tool = getTool("word-to-pdf");
if (!tool?.limits)
  throw new Error("Word to PDF requires its registry configuration.");
export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};
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
