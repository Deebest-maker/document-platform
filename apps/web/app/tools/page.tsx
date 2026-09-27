import type { Metadata } from "next";
import { tools } from "@document-platform/tool-registry";
import { ToolDiscovery } from "../../components/tool-discovery";

export const metadata: Metadata = {
  title: "All tools",
  description:
    "Find document tools by task and category. Merge PDF is available on your device; other tools are planned.",
};

export default function ToolsPage() {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">The toolkit</p>
        <h1>All tools</h1>
        <p className="intro">
          Find a task, check its availability, and see where processing happens.
        </p>
        <p className="notice">
          Merge PDF is available. All other tools are planned and cannot process
          documents yet.
        </p>
      </header>
      <ToolDiscovery records={tools} variant="catalog" />
    </>
  );
}
