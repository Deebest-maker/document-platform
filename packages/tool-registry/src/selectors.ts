import {
  categories,
  tools,
  type CategoryId,
  type ToolDefinition,
} from "./catalog";

export function getTool(slug: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.slug === slug);
}

export function getToolPath(tool: ToolDefinition): string {
  return `/${tool.slug}`;
}

export function getToolHref(tool: ToolDefinition): string {
  return tool.availability === "preview"
    ? getToolPath(tool)
    : `/tools#${tool.slug}`;
}

export function getToolMetadata(tool: ToolDefinition) {
  return {
    title: `${tool.title} — ${tool.availability === "preview" ? "Preview" : "Planned tool"}`,
    description: `${tool.description} This tool is planned and cannot process documents yet.`,
  };
}

export function getRelatedTools(
  tool: ToolDefinition,
): readonly ToolDefinition[] {
  return tool.relatedSlugs.flatMap((slug) => {
    const related = getTool(slug);
    return related ? [related] : [];
  });
}

export function filterTools(
  records: readonly ToolDefinition[],
  query = "",
  category: CategoryId | "all" = "all",
): readonly ToolDefinition[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return records.filter((tool) => {
    const categoryTitle =
      categories.find((item) => item.id === tool.category)?.title ?? "";
    const searchable =
      `${tool.title} ${tool.description} ${categoryTitle}`.toLowerCase();
    return (
      (category === "all" || tool.category === category) &&
      terms.every((term) => searchable.includes(term))
    );
  });
}
