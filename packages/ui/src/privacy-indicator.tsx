import {
  getPrivacyPresentation,
  type ProcessingMode,
} from "@document-platform/tool-registry";

export function PrivacyIndicator({
  processingMode,
}: {
  processingMode: ProcessingMode;
}) {
  const privacy = getPrivacyPresentation(processingMode);
  return (
    <details className="privacy-indicator">
      <summary>{privacy.label}</summary>
      <p>{privacy.explanation}</p>
    </details>
  );
}
