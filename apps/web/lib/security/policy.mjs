/**
 * Browser security policy for the web app (M7C, ADR-034).
 *
 * One place states every header the site sends, so next.config.ts, the proxy
 * and the post-build script cannot drift apart. It is a plain .mjs file (with a
 * .d.mts beside it) because the post-build script runs under plain Node.
 *
 * Three policies:
 *
 *   documentPolicy(hashes)  for every page. Scripts: this origin's files plus
 *                           the page's own inline scripts, each named by its
 *                           SHA-256 hash. No 'unsafe-inline', no 'unsafe-eval'.
 *   WORKER_POLICY           for the files a Web Worker is started from. A
 *                           worker takes its policy from its own script's
 *                           response, so without this a worker would have no
 *                           limits at all. Its network is this origin only.
 *   SECURITY_HEADERS        the plain headers sent on everything.
 *
 * Everything a policy does not name is refused (`default-src 'none'`).
 */

import { createHash } from "node:crypto";

/** A script's hash, in the form a policy lists it. */
export function hashSource(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

const ORIGIN_ONLY = "'self'";

/**
 * The policy for one page.
 *
 * script-src   'self' covers the app's own files (including dynamic imports);
 *              each hash covers one inline script Next.js puts in that page.
 * style-src    this origin's stylesheets only; no inline <style> or style="".
 * img-src      blob: and data: because previews and results are drawn from
 *              in-memory images; never another origin.
 * connect-src  this origin only: the Word to PDF API is reached through it.
 * worker-src   this origin's files; a blob: worker would be code built at run
 *              time, so it is not allowed.
 * form-action  none: nothing on the site submits a form.
 *
 * @param {readonly string[]} hashes  entries from hashSource()
 */
export function documentPolicy(hashes) {
  const scripts = [ORIGIN_ONLY, ...hashes].join(" ");
  return [
    "default-src 'none'",
    `script-src ${scripts}`,
    `style-src ${ORIGIN_ONLY}`,
    `img-src ${ORIGIN_ONLY} blob: data:`,
    `font-src ${ORIGIN_ONLY}`,
    `connect-src ${ORIGIN_ONLY}`,
    `worker-src ${ORIGIN_ONLY}`,
    `manifest-src ${ORIGIN_ONLY}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The policy a worker runs under. WebAssembly is allowed because the PDF
 * reader decodes some images with it; nothing else is, and the only network a
 * worker can reach is this origin (its own data files). A document opened by
 * a worker therefore cannot be sent anywhere.
 */
export const WORKER_POLICY = [
  "default-src 'none'",
  `script-src ${ORIGIN_ONLY} 'wasm-unsafe-eval'`,
  `connect-src ${ORIGIN_ONLY}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Features this site never uses, switched off for the page and anything it
 * embeds. Only features every current engine recognises are listed, so no
 * browser reports an unknown name.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "usb",
]
  .map((feature) => `${feature}=()`)
  .join(", ");

/**
 * Headers for every response of the web app.
 *
 * Referrer-Policy: no-referrer. Nothing here needs it, and a privacy-first
 * site should not tell the next site where a visitor came from. M9 (ads) is
 * where this is revisited.
 *
 * Cross-Origin-Opener-Policy: same-origin. The site opens no windows and
 * talks to none, so it gets its own browsing context group.
 *
 * X-Frame-Options repeats frame-ancestors for engines that predate it.
 *
 * Not here on purpose: Strict-Transport-Security belongs to the HTTPS edge
 * (M8); Cross-Origin-Embedder-Policy would block assets served from a CDN.
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
];
