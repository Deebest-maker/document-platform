# Repository Engineering Instructions

## Authority and role

- Treat the approved documents in `/docs` as the project's source of truth. For each task, read the relevant PRD/SRS requirements and architecture, security, UI/UX, QA, DevOps, roadmap, and Codex instructions. The current user instruction controls the assigned task; do not silently change documented scope or requirements.
- Act as the implementation engineer, not the product owner or final architect. Explain significant technical choices and their consequences in plain language.
- Work on the approved milestone only, in small, usable vertical slices. Do not attempt to build the whole platform at once.

## Required workflow

Follow **Inspect → Plan → Implement → Test → Report**. Inspect existing code and relevant requirement IDs; state a short plan for non-trivial work; implement only the assigned scope; test observable behavior; report results and limitations. Add or update appropriate tests with implemented behavior, including output validity and privacy boundaries. Never disable tests, lint, type checks, or release gates merely to make a build pass.

Stop and ask for a decision before any architectural choice that conflicts with or materially extends `/docs`, including changes to MVP scope, processing location, retention, licensing, or persistent infrastructure. Record approved material decisions in the relevant documentation/ADR.

## Architecture, security, and privacy

- Preserve the privacy-first, local-first hybrid design: suitable operations run in the browser; server processing is disclosed before upload and uses isolated, resource-limited, temporary workspaces with verified cleanup.
- Documents belonging to `LOCAL` tools must never be uploaded to the backend or sent to third parties. Processing-mode labels must match actual behavior.
- Do not add authentication, databases, Redis, queues, cloud storage, AI features, document-exposing analytics, or other infrastructure unless the current milestone and approved documentation explicitly require it. Avoid infrastructure added only for possible future use.
- Never put document contents or bytes, sensitive filenames, passwords, extracted text, page images, document metadata, secrets, or signed download URLs in logs or analytics. Use only allowlisted, coarse operational telemetry that cannot reveal document data.
- Treat all files as untrusted. Keep user-controlled names/options out of trusted paths and shell commands; validate inputs and outputs, constrain processing, and prevent cross-job access.
- Do not add AGPL dependencies, including AGPL variants of PyMuPDF or Ghostscript, without an explicit licensing decision. Review other dependencies for license and security fit.

## Product experience

Preserve the UI/UX specification's calm, precise, editorial utility direction. Keep the real tool and privacy mode immediately clear; provide accessible keyboard and mobile paths, honest states and limits, and an unmistakable download action. Avoid generic AI/SaaS decoration, invented claims, and ads in upload, processing, organizer, or download action areas.

## Milestone gate

After every major development milestone, provide a report covering: what was implemented; architecture/technical decisions; files/modules added or materially changed; tests and results; known limitations; deviations from documentation; security/privacy considerations; unresolved decisions; and the recommended next milestone. **Wait for explicit user approval before beginning that next major milestone.**
