# ADR-032: Abandoned Word to PDF jobs are kept for 10 minutes

**Status:** Decided by the Product Owner (delegated: "use the best for the platform regardless of the minutes"); implemented; accepted and merged (`d599784`)
**Date:** 2026-10-22
**Scope:** The idle period after which the server deletes an abandoned Word to PDF job, and the public wording that states it. No change to normal flow, limits, endpoints or storage.
**Relates to:** ADR-023 (retention policy, 15 minutes as a placeholder), ADR-024 (the three options A, B and C), ADR-030 and ADR-031 (copy that said the period was undecided), governance §9, AGENTS.md (retention changes need a recorded decision).

## Context

Normal flow already deletes the server copy as soon as the PDF has reached the browser (seconds). The janitor only matters for a job that is abandoned: a closed tab, a lost connection, a crash. ADR-024 laid out three options and left the choice to the Product Owner: A 15 minutes, B 10 minutes, C 5 minutes. The Product Owner replied that I should use whatever is best for the platform whatever the minutes.

## Decision

**10 minutes (option B).** The server deletes a job that has had no state change for 10 minutes. The cleanup runs every minute, so an abandoned file should be gone within about 11 minutes.

Why this one:

| Measure                                              | A, 15 min   | **B, 10 min**   | C, 5 min    |
| ---------------------------------------------------- | ----------- | --------------- | ----------- |
| Time an abandoned file can remain (with 1-min sweep) | about 16    | **about 11**    | about 6     |
| Multiple of the slowest measured conversion (15.5 s) | 58×         | **39×**         | 19×         |
| Slowest upload of a 20 MiB file that still completes | 0.19 Mbit/s | **0.28 Mbit/s** | 0.56 Mbit/s |

The product's point is privacy, so shorter is better until it starts failing real people. C starts to cut off uploads of the largest allowed file on slow mobile links, which the owner's users are likely to have; a failed upload only asks the user to retry, but it is a bad experience for no meaningful privacy gain over B once normal flow has already deleted the file. A keeps private bytes on the server for five more minutes than needed. B is the shortest value that leaves wide margins everywhere.

The config floor (the lifetime must exceed the runner timeout plus queue wait, 140 s) is unchanged and still enforced.

## What changed

- `services/processor/app/config.py`: default job lifetime 15 min to 10 min. A processor test pins the 10-minute lifetime and the 60-second sweep.
- `apps/web/lib/retention.ts`: the public numbers (10, 1, 11) in one place, with the one sentence the Privacy page uses.
- Wording that said "after a short time" or "undecided" now states the period: the Privacy page, the Word to PDF tool guide and the privacy guide. The Privacy page still says the final deletion wording and the operating limits are not finalised.
- `apps/web/tests/retention.test.ts` reads `config.py` and fails if the public numbers differ from the processor's defaults, if the idle period is not above the conversion window, or if the Dockerfile or CI sets an override. Site-copy and guide tests now accept only these numbers.
- Records: ADR-023 and ADR-024 point here; ADR-031 and the M6C report are marked accepted and merged.

## Evidence

- Processor tests: 119 pass, 1 skipped (as before). Web tests: 273 pass.
- Putting 15 minutes back in `config.py`, changing the web constant to 9, and restoring "after a short time" on the Privacy page were each caught by a test.
- The janitor's behaviour was verified on a real filesystem in ADR-024 with a 6 s lifetime; this change only moves the default number and I did not repeat that run at 10 minutes.

## Not covered, and limits

1. **Not a legal policy.** The wording describes the configured behaviour. Final retention wording, logs, backups and the hosting provider's own copies are M8 items and need legal review.
2. **Depends on the processor running.** The cleanup is a task inside the processor. If it is down, nothing is deleted until it returns. Monitoring that alerts on a stuck cleanup belongs to M8.
3. **Changing the number later** means changing `config.py`, `lib/retention.ts` and this record together; the test will refuse a mismatch. A deployment that overrides the setting by environment variable would make the public wording wrong, which is why the test checks the image and CI for overrides; production configuration must be checked in M8.
4. **Slow links.** A 20 MiB upload on a link below about 0.28 Mbit/s expires mid-upload and the user retries.

## Consequences

- The privacy story is concrete: deleted at once in normal flow; at most about 11 minutes if abandoned.
- The Product Owner can still choose a different value; it is a two-line change plus this record.
