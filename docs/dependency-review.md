# M0 dependency review

Reviewed on 24 September 2026 against `pnpm-lock.yaml`, `services/processor/uv.lock`, installed package metadata, and the architecture's licensing rules. This records the M0 dependency selection; future dependency changes require another review.

| Area              | Selected tools                                                         | Declared licenses |
| ----------------- | ---------------------------------------------------------------------- | ----------------- |
| Web runtime       | Next.js 16.3.6, React/React DOM 19.3.0, cross-env 10.1.0               | MIT               |
| Styling           | Tailwind CSS/PostCSS integration 4.3.3, PostCSS 8.5.28                 | MIT               |
| Type checking     | TypeScript 5.9.3                                                       | Apache-2.0        |
| Web quality       | ESLint 9.39.5, Next ESLint config 16.3.6, Prettier 3.9.9, Vitest 5.0.1 | MIT               |
| Browser checks    | Playwright 1.63.0                                                      | Apache-2.0        |
| Processor runtime | FastAPI 0.141.1, Pydantic 2.13.5; Uvicorn 0.53.0                       | MIT; BSD-3-Clause |
| Python quality    | Ruff 0.16.8, mypy 1.20.2, pytest 9.1.1; HTTPX2 2.13.1                  | MIT; BSD-3-Clause |

The installed Windows inventory contained 402 JavaScript package records and 27 Python distributions. No AGPL license identifiers or unknown license categories appeared. JavaScript inventory categories were MIT, MIT-0, Apache-2.0, Apache-2.0 AND LGPL-3.0-or-later, Python-2.0, MPL-2.0, CC-BY-4.0, BSD-2-Clause, ISC, BSD-3-Clause, CC0-1.0, BlueOak-1.0.0, and 0BSD. Python inventory additionally included PSF-2.0 and dual Apache/BSD terms. Counts vary by operating system because native optional packages differ.

Retain the notices shipped with dependencies and containers. In particular, Next.js's optional Sharp binary includes LGPL terms; Lightning CSS, axe-core, and Python's development dependency pathspec include MPL terms. None is an AGPL document engine. PyMuPDF, Ghostscript, PDF libraries, and Office conversion engines are not part of M0.

ESLint remains on the deprecated 9.x line because the installed Next.js React/import plugins declare support through ESLint 9. TypeScript 5.9 is within the installed TypeScript ESLint parser's supported range. The dependency audit found no known vulnerabilities; reevaluate this compatibility constraint when the lint plugins support ESLint 10. Do not force incompatible peers or suppress lint checks.

Reproduce the metadata review with `pnpm licenses list --json` and `importlib.metadata` inside the processor's locked environment. Run `pnpm audit --audit-level=high` and `uv audit --locked --project services/processor` for current vulnerability results. The pinned uv release exposes its audit command as experimental; its results and exit status remain part of the M0 CI check.
