import type { Metadata } from "next";
import { processingModes } from "@document-platform/tool-registry";
import { PrivacyIndicator } from "@document-platform/ui";
import {
  capitalise,
  countWord,
  getAvailabilitySummary,
  getModeAvailability,
} from "../../lib/availability";
import { seoMetadata } from "../../lib/seo";

export const metadata: Metadata = seoMetadata({
  title: "Privacy — draft",
  description:
    "Where documents are processed in this product preview, and what is not yet decided. Privacy policy not finalized.",
  path: "/privacy",
});

export default function PrivacyPage() {
  const summary = getAvailabilitySummary();
  return (
    <article className="reading-page">
      <p className="eyebrow">Privacy &amp; processing</p>
      <h1>Know where the work happens</h1>
      <p className="notice">
        Draft information — this is not a finalized privacy policy.
      </p>
      <p className="intro">
        {capitalise(countWord(summary.local))} of the{" "}
        {countWord(summary.available)} available tools process documents and
        images entirely in your browser. For those tools, document bytes are
        never uploaded to our servers or third parties. Remove PDF Metadata
        removes supported fields only — it is not secure redaction and does not
        touch content inside the pages. Selected files and results stay in this
        page session; Start over or leaving the page releases those references.
        This is not a promise of secure memory erasure.
      </p>
      <h2>The tool that uses our server</h2>
      <p>
        Word to PDF uploads your Word file to our conversion server over an
        encrypted connection and converts it there. The tool tells you this
        before anything is uploaded. The server copy is deleted as soon as the
        PDF has reached your browser, and files left behind by an abandoned
        conversion are deleted automatically after a short time. Files are never
        shared with third parties.
      </p>
      <h2>Three processing modes</h2>
      <p>
        Every tool shows its processing mode. The labels below explain all three
        modes; a mode is marked as planned until a tool that uses it is
        available.
      </p>
      <div className="privacy-explanations">
        {processingModes.map((processingMode) => (
          <PrivacyIndicator
            key={processingMode}
            processingMode={processingMode}
            availability={getModeAvailability(processingMode)}
          />
        ))}
      </div>
      <h2>What remains undecided</h2>
      <p>
        For Word to PDF, the exact retention period for abandoned conversions,
        the remaining deletion details and the operating limits have not been
        finalized. Those details must be reviewed and disclosed before public
        launch.
      </p>
      <p>
        A future change to a tool’s processing location requires review and an
        updated disclosure. A local label must match the operation’s actual
        behavior.
      </p>
    </article>
  );
}
