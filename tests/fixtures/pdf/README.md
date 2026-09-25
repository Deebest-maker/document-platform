# Merge fixture corpus

All documents are small, original synthetic test data. They contain no user documents or sensitive information. Provenance, authoring-tool versions, checksums, page identities and independently specified expected orders are in `manifest.json`.

- `a.pdf`, `b.pdf`: two pages each, with distinct visible markers, dimensions and rotations.
- `c.pdf`, `d.pdf`: one-page inputs, including a rotated page.
- `form.pdf`: a real interactive text field with an explicit appearance and synthetic value.
- `signed.pdf`: a real detached CMS signature from a synthetic self-signed identity; it is not a trusted identity certificate. No private key is retained.
- `encrypted.pdf`: genuinely AES-256 password-encrypted; deliberately unsupported by Merge. The public fixture password is `synthetic-fixture-only`.
- `corrupt.pdf`, `truncated.pdf`: intentionally invalid inputs. Zero-byte and wrong-type inputs are constructed in tests.

These are project-owned test data with no third-party document license. The optional authoring script is `../generate.py`. It uses preinstalled ReportLab (BSD), pypdf (BSD-3-Clause), and cryptography (Apache-2.0 OR BSD-3-Clause); none is added to production, processor, or CI dependencies. Running the tests needs only the checked-in fixtures. Regeneration changes encrypted/signature bytes; review and commit the updated manifest with them.

Order assertions inspect actual page content and geometry, using the manifest as the oracle. They do not ask the merge implementation to calculate expected order. Browser/download artifacts may contain these synthetic documents only.

Git treats PDFs as binary to preserve exact bytes, cross-reference offsets and the source signature across Windows/Linux checkouts. Do not run text whitespace or line-ending normalization on these files.
