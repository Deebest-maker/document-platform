# Architecture decision records

Material architecture decisions require human review under `AGENTS.md`. Record context, the approved decision, consequences, and links to the governing requirements. An ADR must not silently change PRD/SRS scope.

The architecture baseline in `../04_System_Architecture_Technical_Design.docx`, section 16, already reserves ADR-001 through ADR-009 for the approved stack, local-first processing, licensing, and infrastructure decisions. Their authoritative text remains in that document.

| Record                                    | Status                                                    | Decision                                                                             |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [ADR-010](010-m0-workspace-foundation.md) | Accepted within approved M0 scope                         | Workspace tooling and minimal foundation boundaries                                  |
| [ADR-011](011-m1-product-shell.md)        | Accepted with M1 architecture amendments                  | Registry, nonfunctional preview, neutral privacy wording, and minimal shared UI      |
| [ADR-012](012-m2a-local-merge.md)         | Implemented within M2A approval; owner acceptance pending | LOCAL Merge, measured worker decision, route-local lifecycle and conservative limits |

Use the next available identifier for a new decision. Later proposals must state whether they refine or supersede an existing decision and update affected source documents after approval.
