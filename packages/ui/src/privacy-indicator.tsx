import {
  getPrivacyPresentation,
  type ProcessingMode,
  type PageAvailability,
} from "@document-platform/tool-registry";

export function PrivacyIndicator({
  processingMode,
  availability,
}: {
  processingMode: ProcessingMode;
  availability?: PageAvailability;
}) {
  const privacy = getPrivacyPresentation(processingMode, availability);
  return (
    <details className="privacy-indicator">
      <summary>{privacy.label}</summary>
      <p>{privacy.explanation}</p>
    </details>
  );
}
