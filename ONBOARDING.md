# TaxOps Onboarding

Use this file when entering `projects/tax-ops` fresh and you need the fastest reliable path to current context.

## Read in this order

1. `README.md`
   - Product summary, current scope, and high-level workflow.

2. `PROJECT_STRUCTURE.md`
   - Codebase layout, important folders, and where major concerns live.

3. `IMPLEMENTATION_PLAN.md`
   - Current progress checklist, completed work, in-progress priorities, and deferred items.

4. `docs/architecture/1099B_EXTRACTOR_BLUEPRINT.md`
   - Locked product/UX/architecture plan for the 1099-B Extractor.

## Then inspect current implementation state

After reading the docs above, inspect the code that matches the task:

- Web UI: `apps/web/src/`
- Server/API: `apps/server/src/`
- Worker/OCR pipeline: `apps/worker/src/`
- Deployment/runtime notes: `docs/deployment/`

## Current product reality

- The current app is primarily an **Admin foundation**, not the final staff workflow.
- The UI now uses a compact **left sidebar** with:
  - `Clients`
  - `Tools`
  - `1099-B Extractor` placeholder
  - admin access available from the user menu for admin users
- OCRmyPDF settings, OCR review/rerun behavior, and watch-folder processing are already implemented as the current document-processing base.

## Locked decisions to remember

- **1099-B Extractor** is the next major tool to build.
- Extraction flow is **review-first**:
  - OCR selected pages
  - AI extracts **one page at a time**
  - users can review completed pages while later pages continue processing
  - TXF export uses data from **Reviewed pages only**
- Source documents should support:
  - local upload
  - already-ingested TaxOps documents
- Client linkage is **not required initially**; add it later as an optional workflow.
- The extractor architecture should generalize so later forms mainly differ by:
  - AI prompt
  - output schema

## If you are planning new work

Before changing direction, confirm your work aligns with:

- `IMPLEMENTATION_PLAN.md` for priority/order
- `docs/architecture/1099B_EXTRACTOR_BLUEPRINT.md` for locked extractor behavior

If you learn something important or change the plan, update the docs above so the next person does not have to reconstruct context from chat history.

## Documentation discipline

- Update these onboarding/planning/architecture files as needed whenever the project direction, build order, workflow, or locked decisions change.
