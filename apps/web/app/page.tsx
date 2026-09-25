import Link from "next/link";
import {
  categories,
  getToolHref,
  processingModes,
  tools,
} from "@document-platform/tool-registry";
import { PrivacyIndicator } from "@document-platform/ui";
import { ToolDiscovery } from "../components/tool-discovery";
import { ToolList } from "../components/tool-list";

export default function HomePage() {
  return (
    <>
      <section className="home-hero" aria-labelledby="home-heading">
        <div>
          <p className="eyebrow">A document toolkit, in progress</p>
          <h1 id="home-heading">
            Find the right tool
            <br className="desktop-break" /> for your document.
          </h1>
          <p className="intro">
            Merge PDFs on your device. Explore the tools planned for other
            everyday file tasks, with processing locations clearly explained.
          </p>
          <Link className="text-link" href="/tools">
            Browse all tools <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="home-search">
          <p className="eyebrow">Start with a task</p>
          <ToolDiscovery records={tools} variant="compact" />
        </div>
      </section>
      <section className="home-section" aria-labelledby="featured-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The toolkit</p>
            <h2 id="featured-heading">Common document tasks</h2>
          </div>
          <Link className="text-link" href="/tools">
            View all tools <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ToolList records={tools.filter((tool) => tool.featured)} />
      </section>
      <section className="home-section" aria-labelledby="categories-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Explore by purpose</p>
            <h2 id="categories-heading">What needs to change?</h2>
          </div>
        </div>
        <div className="category-browser">
          {categories.map((category) => (
            <section
              key={category.id}
              aria-labelledby={`category-${category.id}`}
            >
              <h3 id={`category-${category.id}`}>{category.title}</h3>
              <p>{category.description}</p>
              <ul>
                {tools
                  .filter((tool) => tool.category === category.id)
                  .slice(0, 2)
                  .map((tool) => (
                    <li key={tool.slug}>
                      <Link href={getToolHref(tool)}>{tool.title}</Link>
                    </li>
                  ))}
              </ul>
              <Link className="text-link" href={`/tools#${category.id}`}>
                View {category.title.toLowerCase()} tools{" "}
                <span aria-hidden="true">→</span>
              </Link>
            </section>
          ))}
        </div>
      </section>
      <section
        className="home-section privacy-section"
        aria-labelledby="privacy-heading"
      >
        <div>
          <p className="eyebrow">Privacy, explained</p>
          <h2 id="privacy-heading">
            Know where your
            <br className="desktop-break" /> document would go.
          </h2>
          <p>
            Merge runs in your browser without uploading your PDFs. Other tools
            are planned; their labels explain the intended processing location.
          </p>
          <Link className="text-link" href="/privacy">
            Read about privacy <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="privacy-explanations">
          {processingModes.map((mode) => (
            <PrivacyIndicator key={mode} processingMode={mode} />
          ))}
        </div>
      </section>
    </>
  );
}
