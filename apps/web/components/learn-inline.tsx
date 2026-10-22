import Link from "next/link";
import { resolveInline } from "../lib/learn-text";

/**
 * Renders guide text with its {tool:…}, {learn:…} and {page:…} tokens turned
 * into links. Resolution happens at build time, so a broken token fails the
 * build instead of shipping a dead link (ADR-031).
 */
export function LearnInline({ text }: { text: string }) {
  return (
    <>
      {resolveInline(text).map((segment, index) =>
        segment.kind === "text" ? (
          segment.text
        ) : (
          <Link key={`${segment.href}-${index}`} href={segment.href}>
            {segment.label}
          </Link>
        ),
      )}
    </>
  );
}
