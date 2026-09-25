import type { Metadata } from "next";
import { tools } from "@document-platform/tool-registry";
import { ToolDiscovery } from "../../components/tool-discovery";

export const metadata: Metadata = {
  title: "All tools",
  description:
    "Explore the planned document tools by task and category. Document processing is not available yet.",
};

export default function ToolsPage() {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">The planned toolkit</p>
        <h1>All tools</h1>
        <p className="intro">
          Find a task, see its planned processing location, and explore what is
          coming.
        </p>
        <p className="notice">
          These tools are not functional yet. Merge PDF has a page preview only.
        </p>
      </header>
      <ToolDiscovery records={tools} variant="catalog" />
    </>
  );
}
