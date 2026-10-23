import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { currentManifest, policyFor } from "./lib/security/document-policy";

/**
 * Adds the page Content-Security-Policy (M7C, ADR-034).
 *
 * The pages are prerendered, so a per-request nonce is not possible; the
 * policy instead names the hash of each inline script the page really has
 * (see lib/security/document-policy.ts). In development Next.js needs eval and
 * inline scripts for hot reload, so the policy is a production-build rule and
 * the browser tests run against a production build.
 *
 * Files under /_next, /vendor and /api are not pages and are skipped: static
 * files get their headers from next.config.ts, and /api/processor/* carries
 * the processor's own headers.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Content-Security-Policy",
      policyFor(currentManifest(), request.nextUrl.pathname),
    );
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/|vendor/).*)"],
};
