# PROJECT_STRUCTURE.md

## tax-ops repository layout

This repository is structured as a single-deployable-image application with separate workspace areas for the web UI, API/server, document-processing worker logic, shared types/utilities, deployment assets, and living project documentation.

```text
tax-ops/
├── README.md
├── IMPLEMENTATION_PLAN.md
├── PROJECT_STRUCTURE.md
├── package.json
├── .gitignore
├── .env.example
├── apps/
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   ├── index.html
│   │   └── package.json
│   ├── server/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── routes/
│   │   │   ├── modules/
│   │   │   ├── db/
│   │   │   ├── auth/
│   │   │   └── config/
│   │   └── package.json
│   └── worker/
│       ├── src/
│       │   ├── jobs/
│       │   ├── ocr/
│       │   ├── pdf/
│       │   ├── intake/
│       │   └── classification/
│       └── package.json
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── types/
│       │   ├── schemas/
│       │   ├── constants/
│       │   ├── utils/
│       │   └── naming/
│       └── package.json
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── api/
│   ├── workflows/
│   └── deployment/
├── docker/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   └── compose.dev.yml
├── unraid/
│   └── tax-ops.xml
├── scripts/
│   ├── dev/
│   ├── db/
│   ├── release/
│   └── smoke/
├── .github/
│   └── workflows/
└── examples/
    ├── sample-config/
    └── sample-data/
```

## Top-level rationale

### `README.md`
Primary project overview: what tax-ops is, why it exists, stack choices, deployment assumptions, and current roadmap.

### `IMPLEMENTATION_PLAN.md`
Living phased execution plan with milestones, dependencies, and progress tracking.

### `PROJECT_STRUCTURE.md`
Canonical map of the repo so future contributors and subagents work from the same layout.

### `apps/`
Application code split by runtime responsibility while still shipping as one deployable image.

- **`apps/web/`** — React/Vite frontend for staff/admin workflows
- **`apps/server/`** — API, auth, settings, DB access, and application orchestration
- **`apps/worker/`** — OCR, watched-folder intake, PDF prep, classification, and background jobs

### `packages/shared/`
Shared TypeScript types, validation schemas, constants, naming helpers, and utilities used by web/server/worker code.

### `docs/`
Longer-form documentation that should stay out of the root: architecture notes, ADRs, API contracts, workflow specs, and deployment guidance.

Notable current docs include:
- `docs/architecture/1099B_EXTRACTOR_BLUEPRINT.md` — locked workflow/product blueprint for the first major Tools feature
- `docs/deployment/UNRAID_FIRST_RUN.md` — first deployment checklist
- `docs/deployment/OCR_RUNTIME_REQUIREMENTS.md` — OCR runtime requirements

### `docker/`
Single-container build assets and local development container helpers.

### `unraid/`
Unraid-specific deployment assets, starting with the template XML for easy installation and updates.

### `scripts/`
Operational scripts for dev setup, DB migrations, release packaging, and smoke tests.

### `.github/workflows/`
CI workflows for lint, typecheck, build, and release-related automation.

### `examples/`
Example configs and sanitized sample data for testing parsers, OCR flows, and documentation.

## Runtime model

Although the repo separates responsibilities into `web`, `server`, and `worker`, the deployment target is still a **single Docker container**. The container will:

- serve the frontend assets
- run the API server
- run background worker processes for OCR/intake/classification

This gives us clean source organization without forcing a multi-container production deployment.

## Storage/path strategy

App code should prefer configurable storage roots and database-stored relative paths rather than hardcoded machine-specific absolute paths. This keeps the app portable between:

- home development environment
- office Unraid deployment

## Documentation rule

If the real repo structure changes during development, this file should be updated in the same phase/PR so docs stay truthful.
