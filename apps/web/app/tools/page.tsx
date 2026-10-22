import type { Metadata } from "next";
import { tools } from "@document-platform/tool-registry";
import { ToolDiscovery } from "../../components/tool-discovery";
import {
  availabilityBreakdown,
  getAvailabilitySummary,
  plannedRemainder,
} from "../../lib/availability";
import { seoMetadata } from "../../lib/seo";

const summary = getAvailabilitySummary();

export const metadata: Metadata = seoMetadata({
  title: "All tools",
  description: `Find document tools by task and category. ${availabilityBreakdown(summary)}`,
  path: "/tools",
});

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
          {availabilityBreakdown(summary)} {plannedRemainder(summary)}
        </p>
      </header>
      <ToolDiscovery records={tools} variant="catalog" />
    </>
  );
}
