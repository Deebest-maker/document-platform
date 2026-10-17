# metadata-rich.pdf

Synthetic 3-page PDF produced by `tests/fixtures/scripts/generate-metadata-rich.mjs` for M3B.4 Remove PDF Metadata.

**Not a real document.** No real person's or organisation's data.

Contents:

- 3 letter-sized pages (612×792 pt). Page 2 is rotated 90° (clockwise).
- Every ISO 32000-1 §14.3.3 standard Info field populated:
  - `/Title` = `SECRET-TITLE-CANARY-9Hjk`
  - `/Author` = `SECRET-AUTHOR-CANARY-2Fqz`
  - `/Subject` = `subject-canary-7Rw`
  - `/Keywords` = `kw-canary-1 kw-canary-2`
  - `/Creator` = `creator-canary-M8`
  - `/Producer` = `producer-canary-X4`
  - `/CreationDate` = 2024-01-01T00:00:00Z
  - `/ModDate` = 2024-06-01T00:00:00Z
  - `/Trapped` = `/False` (written via the low-level Info dictionary; pdf-lib has no setter)
- Two custom Info keys:
  - `/AcmeInternalCanary` = `ACME-INTERNAL-CANARY-X3b`
  - `/InternalTag` = `not-for-sharing`
- Catalog `/Metadata` XMP stream containing `XMP-CANARY-V7m`.
- No trailer `/ID`: pdf-lib does not write one, so this fixture does not exercise trailer `/ID` removal.

Canary strings used by the Playwright privacy audit:

- `SECRET-TITLE-CANARY-9Hjk`
- `SECRET-AUTHOR-CANARY-2Fqz`
- `ACME-INTERNAL-CANARY-X3b`
- `XMP-CANARY-V7m`

These strings MUST NOT appear in any outbound network request body or in any browser console log while the user is interacting with the Remove PDF Metadata page.

Regeneration: `node tests/fixtures/scripts/generate-metadata-rich.mjs`
