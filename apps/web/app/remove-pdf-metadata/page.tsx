import type { Metadata } from "next";
import type { MetadataRemovalLimits } from "@document-platform/pdf-browser/metadata-removal";
import { getTool } from "@document-platform/tool-registry";
import { RemovePdfMetadataWorkspace } from "../../components/remove-pdf-metadata/remove-pdf-metadata-workspace";
import { ToolGuide } from "../../components/tool-guide";
import { toolMetadata } from "../../lib/seo";

const tool = getTool("remove-pdf-metadata");
const configured = tool?.limits;
if (
  !tool ||
  !configured?.maxFileBytes ||
  !configured.maxPages ||
  !configured.maxOutputBytes
)
  throw new Error(
    "Remove PDF Metadata requires registry-backed engineering limits.",
  );

const limits: MetadataRemovalLimits = {
  maxInputBytes: configured.maxFileBytes,
  maxPages: configured.maxPages,
  maxOutputBytes: configured.maxOutputBytes,
};

export const metadata: Metadata = toolMetadata(tool);

export default function RemovePdfMetadataPage() {
  return (
    <RemovePdfMetadataWorkspace
      tool={tool!}
      limits={limits}
      related={<ToolGuide tool={tool!} />}
    />
  );
}
