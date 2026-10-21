import type { Metadata } from "next";
import type { PdfToTextLimits } from "@document-platform/pdf-browser/pdf-to-text";
import { getTool } from "@document-platform/tool-registry";
import { PdfToTextWorkspace } from "../../components/pdf-to-text/pdf-to-text-workspace";
import { ToolGuide } from "../../components/tool-guide";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("pdf-to-text");
const configured = tool?.limits;
if (
  !tool ||
  !configured?.maxTextCharacters ||
  !configured.maxTextBytes ||
  !configured.maxPreviewCharacters
)
  throw new Error("PDF to Text requires registry-backed text limits.");

const limits: PdfToTextLimits = {
  maxCharacters: configured.maxTextCharacters,
  maxBytes: configured.maxTextBytes,
  maxPreviewCharacters: configured.maxPreviewCharacters,
};

export const metadata: Metadata = toolMetadata(tool);

export default function PdfToTextPage() {
  return (
    <PdfToTextWorkspace
      tool={tool!}
      limits={limits}
      related={<ToolGuide tool={tool!} />}
    />
  );
}
