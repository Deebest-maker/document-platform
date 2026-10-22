/**
 * How long the server keeps an abandoned Word to PDF job (ADR-032).
 *
 * These numbers are what the Privacy page, the Word to PDF guide and the
 * privacy guide say. They must equal the processor's defaults in
 * services/processor/app/config.py; tests/retention.test.ts reads that file and
 * fails if the two disagree, so the public wording cannot drift from the
 * setting.
 *
 * Normal flow does not depend on them: the server copy is deleted as soon as
 * the PDF has reached the browser. They only govern a conversion that is
 * abandoned, for example because the tab was closed.
 */

/** A job idle for this long is deleted by the server's cleanup. */
export const ABANDONED_JOB_IDLE_MINUTES = 10;

/** The cleanup runs this often. */
export const CLEANUP_INTERVAL_MINUTES = 1;

/** Longest an abandoned job can remain: idle period plus one cleanup interval. */
export const ABANDONED_JOB_MAX_MINUTES =
  ABANDONED_JOB_IDLE_MINUTES + CLEANUP_INTERVAL_MINUTES;

/** One sentence for the places that describe what happens to an abandoned job. */
export const abandonedJobSentence =
  `A conversion that is abandoned, for example because the tab was closed, is deleted automatically once it has been idle for ${ABANDONED_JOB_IDLE_MINUTES} minutes. ` +
  `The cleanup runs every ${CLEANUP_INTERVAL_MINUTES === 1 ? "minute" : `${CLEANUP_INTERVAL_MINUTES} minutes`}, so such a file should be gone within about ${ABANDONED_JOB_MAX_MINUTES} minutes.`;
