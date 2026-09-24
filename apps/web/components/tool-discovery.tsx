"use client";

import { useId, useRef, useState } from "react";
import {
  categories,
  filterTools,
  type CategoryId,
  type ToolDefinition,
} from "@document-platform/tool-registry";
import { ToolList } from "./tool-list";

export function ToolDiscovery({
  records,
  variant,
}: {
  records: readonly ToolDefinition[];
  variant: "compact" | "catalog";
}) {
  const searchId = useId();
  const categoryId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const results = filterTools(records, query, category);
  const showResults = variant === "catalog" || query.trim().length > 0;

  function reset() {
    setQuery("");
    setCategory("all");
    searchRef.current?.focus();
  }

  return (
    <div className={`tool-discovery discovery-${variant}`}>
      <div
        role="search"
        aria-label="Find document tools"
        className="search-controls"
      >
        <div className="search-field">
          <label htmlFor={searchId}>Find a tool</label>
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “merge” or “images”"
            autoComplete="off"
            maxLength={120}
          />
        </div>
        {variant === "catalog" && (
          <div className="category-field">
            <label htmlFor={categoryId}>Filter by category</label>
            <select
              id={categoryId}
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as CategoryId | "all")
              }
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          className="quiet-button reset-button"
          type="button"
          onClick={reset}
          disabled={!query && category === "all"}
        >
          Reset search
        </button>
      </div>
      <p className="search-summary" role="status" aria-atomic="true">
        {showResults
          ? `${results.length} ${results.length === 1 ? "tool" : "tools"} found. All document processing is planned.`
          : "Search by task, format or category."}
      </p>
      {showResults && results.length === 0 && (
        <div className="empty-results">
          <h2>No tools match this search</h2>
          <p>
            Try a shorter task name or reset your search and category filter.
          </p>
        </div>
      )}
      {showResults && results.length > 0 && (
        <div className="catalog-results">
          {categories.map((item) => {
            const group = results.filter((tool) => tool.category === item.id);
            return (
              group.length > 0 && (
                <section
                  key={item.id}
                  id={variant === "catalog" ? item.id : undefined}
                  aria-labelledby={`${searchId}-${item.id}`}
                >
                  <div className="category-heading">
                    <h2 id={`${searchId}-${item.id}`}>{item.title}</h2>
                    {variant === "catalog" && <p>{item.description}</p>}
                  </div>
                  <ToolList records={group} anchorIds={variant === "catalog"} />
                </section>
              )
            );
          })}
        </div>
      )}
    </div>
  );
}
