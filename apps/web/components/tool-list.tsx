import Link from "next/link";
import {
  categories,
  getToolHref,
  type ToolDefinition,
} from "@document-platform/tool-registry";
import { PrivacyIndicator } from "@document-platform/ui";

export function ToolList({
  records,
  anchorIds = false,
}: {
  records: readonly ToolDefinition[];
  anchorIds?: boolean;
}) {
  return (
    <ul className="tool-list">
      {records.map((tool) => (
        <li
          className="tool-row"
          key={tool.slug}
          id={anchorIds ? tool.slug : undefined}
        >
          <div className="tool-row-top">
            <span className="tool-category">
              {
                categories.find((category) => category.id === tool.category)
                  ?.title
              }
            </span>
            <span className="availability">
              {tool.availability === "available"
                ? "Available"
                : tool.availability === "preview"
                  ? "Page preview"
                  : "Planned"}
            </span>
          </div>
          <h3>
            {tool.availability !== "planned" || !anchorIds ? (
              <Link href={getToolHref(tool)}>
                {tool.title}
                <span aria-hidden="true"> ↗</span>
              </Link>
            ) : (
              tool.title
            )}
          </h3>
          <p className="tool-description">{tool.description}</p>
          <PrivacyIndicator
            processingMode={tool.processingMode}
            availability={tool.availability}
          />
        </li>
      ))}
    </ul>
  );
}
