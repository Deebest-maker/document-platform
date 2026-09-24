import type { Metadata } from "next";
import Link from "next/link";
import {
  getRelatedTools,
  getTool,
  getToolMetadata,
} from "@document-platform/tool-registry";
import { ToolShell } from "@document-platform/ui";
import { ToolList } from "../../components/tool-list";

const tool = getTool("merge-pdf");
if (!tool) throw new Error("The Merge preview requires its registry record.");

export const metadata: Metadata = {
  ...getToolMetadata(tool),
  robots: { index: false, follow: false },
};

export default function MergePreviewPage() {
  return (
    <ToolShell
      tool={tool!}
      state="idle"
      workspace={
        <>
          <p className="eyebrow">Preview only</p>
          <h2>This tool is not available yet</h2>
          <p>
            This page previews the layout and planned processing mode. You
            cannot choose, upload, merge or download documents here.
          </p>
          <Link className="text-link" href="/tools">
            Explore the planned tools <span aria-hidden="true">→</span>
          </Link>
          <p className="small-copy">
            <Link href="/privacy">Read about the planned privacy model</Link>
          </p>
        </>
      }
      related={
        <>
          <h2>Related planned tools</h2>
          <ToolList records={getRelatedTools(tool!)} />
        </>
      }
    />
  );
}
