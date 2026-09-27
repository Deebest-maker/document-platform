import type { Metadata } from "next";
import { processingModes } from "@document-platform/tool-registry";
import { PrivacyIndicator } from "@document-platform/ui";

export const metadata: Metadata = {
  title: "Privacy — draft",
  description:
    "The planned processing model and the limits of this product preview. Privacy policy not finalized.",
};

export default function PrivacyPage() {
  return (
    <article className="reading-page">
      <p className="eyebrow">Privacy &amp; processing</p>
      <h1>Know where the work happens</h1>
      <p className="notice">
        Draft information — this is not a finalized privacy policy.
      </p>
      <p className="intro">
        Merge PDF processes documents entirely in your browser. Document bytes
        are never uploaded to our servers or third parties. Selected files and
        the result stay in this page session; Start over or leaving the page
        releases those references. This is not a promise of secure memory
        erasure.
      </p>
      <h2>Three processing modes</h2>
      <p>
        Merge is the only available tool. The labels below describe the planned
        model for future tools.
      </p>
      <div className="privacy-explanations">
        {processingModes.map((processingMode) => (
          <PrivacyIndicator
            key={processingMode}
            processingMode={processingMode}
          />
        ))}
      </div>
      <h2>What remains undecided</h2>
      <p>
        Server retention periods, deletion details and operating limits have not
        been finalized. Those details must be reviewed and disclosed before
        server tools become available.
      </p>
      <p>
        A future change to a tool’s processing location requires review and an
        updated disclosure. A local label must match the operation’s actual
        behavior.
      </p>
    </article>
  );
}
