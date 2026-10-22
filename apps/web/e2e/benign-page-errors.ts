/**
 * Page errors that are the browser reporting its own cancelled work, not the
 * product failing.
 *
 * Next.js prefetches the pages a link points to. When a test (or a person)
 * moves on to another page, WebKit reports the prefetches still in flight as
 * errors ending "... due to access control checks". Only that one shape is
 * ignored: a request for a page's `_rsc` payload that was cancelled. Any other
 * failed request, and any script error, is still reported.
 */
const CANCELLED_PREFETCH = /[?&]_rsc=[\w-]+ due to access control checks\.?$/;

export function isCancelledPrefetch(message: string): boolean {
  return CANCELLED_PREFETCH.test(message.trim());
}
