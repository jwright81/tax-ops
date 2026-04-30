# IMPLEMENTATION_PLAN.md

## tax-ops implementation plan

Tax-ops is a compact, operations-first tax workflow app for scanned intake, OCR, review, classification, client filing, and 1099-B/TXF tooling. The product should remain simple to deploy, fast for office staff to use, and safe when automation confidence is low.

## Decisions already made

- **Database:** MariaDB
- **Auth/admin:** admin-managed users
- **Deployment shape:** single Docker container
- **UI direction:** compact Linear-style interface
- **Repository:** GitHub (`https://github.com/jwright81/tax-ops`)
- **Container image:** `ghcr.io/jwright81/tax-ops:latest`
- **Target environment:** local home development + office Unraid deployment
- **File naming:** include SSN last4 when confidence is high
- **Execution model:** larger implementation tasks will be planned and delegated through subagents, then reviewed and consolidated

---

## Phase 1 — Foundation / Bootstrap

### Goal
Stand up the repository, app skeleton, deployment path, and operator/admin foundation.

### Milestones
- Repo initialized and documented
- Single-container app boots locally
- MariaDB connection and migrations work
- Bootstrap admin flow works
- Base app shell and navigation exist

### Deliverables
- Monorepo/workspace structure
- README, project structure doc, and implementation plan
- Dockerfile and local compose/dev path
- MariaDB schema baseline
- Auth/session model
- Admin user CRUD foundation
- Base UI shell, theme tokens, and navigation
- CI basics: lint, typecheck, build

### Dependencies
- GitHub repository (`jwright81/tax-ops`)
- GitHub Actions / GHCR publish path for image updates
- MariaDB instance available in dev
- Docker runtime available locally

### Exit criteria
- App runs locally through Docker
- Admin can log in and manage users
- Repo docs match actual scaffold

---

## Phase 2 — Intake + OCR

### Goal
Ingest scanned PDFs from uploads or watched folders and convert them into searchable, normalized documents.

### Milestones
- Intake pipeline working for uploads and watched-folder imports
- OCR extraction producing searchable PDFs and text
- Page rotation/orientation correction working
- Initial metadata stored in MariaDB
- Naming rules implemented, including SSN last4 when confident

### Deliverables
- Intake UI + API endpoints
- Watched-folder ingest worker
- Original-file preservation rules
- OCR integration
- PDF prep pipeline (rotate, deskew, normalize)
- Extracted text + per-page metadata persistence
- Audit entries for imports/renames

### Dependencies
- Phase 1 complete
- Storage path conventions finalized
- OCR toolchain selected and containerized

### Exit criteria
- New scanned PDF enters pipeline automatically
- OCR output is searchable
- Document job status is visible in UI

---

## Phase 3 — Review / Classification

### Goal
Help staff quickly review extracted documents, verify classifications, and correct uncertain automation.

### Milestones
- Review queue live
- Document classification workflow live
- Multi-page packet splitting supported
- Manual correction/editing supported
- Status tracking from intake to reviewed

### Deliverables
- Review dashboard
- Per-document and per-page preview UI
- Classification model/rules engine
- Confidence scoring and exception handling
- Split/merge page controls
- Review history and change log

### Dependencies
- OCR pipeline stable
- Shared document/page data model finalized
- Staff/admin permission model available

### Exit criteria
- Staff can resolve low-confidence documents without DB/file-system hand editing
- Review actions are auditable

---

## Phase 4 — Client Filing

### Goal
Move approved documents into structured client/year storage with safe naming and client matching support.

### Milestones
- Client records and matching workflow complete
- Filing suggestions available
- Approved documents exported/moved into client folders
- Filing status tracked end-to-end

### Deliverables
- Client record management
- Suggested client matching using names, spouse names, SSN last4, payer/broker, and tax year
- Canonical filename builder
- Relative-path storage strategy in DB
- Filing checklist/status states
- Duplicate/conflict detection where practical

### Dependencies
- Review/classification workflow operational
- Stable client/document schema
- Storage root settings finalized

### Exit criteria
- Approved document can be filed to the correct client/year folder from the UI
- Low-confidence matches require human review rather than silent auto-filing

---

## Phase 5 — 1099-B / TXF Integration

### Goal
Ship the **1099-B Extractor** as the first major tool under `Tools`, with page-by-page review, progressive processing, and TXF export based only on user-reviewed data.

### Locked decisions
- 1099-B Extractor is the first major Tools workflow to build
- A run can start from either local PDF upload or an already-ingested TaxOps document
- Existing-document selection should respect admin-managed document naming/types and prioritize docs classified as `1099-B`
- Users can review finished pages while AI continues processing remaining pages
- **Reviewed** is page-level user certification that the right-pane data is correct after edits/additions/deletions
- TXF output must use final edited values from Reviewed pages only
- Client linkage is optional at first and should not block the initial tool launch
- The architecture should generalize so future forms mostly swap AI prompt + structured output schema
- User-provided TXF reference files should be retained as implementation/validation fixtures

### Milestones
- Tool run model defined for upload + existing-document entry paths
- Dual-pane page review flow implemented
- Progressive per-page extraction available while run remains active
- TXF exporter reads Reviewed page data only
- Shared form-tool scaffold established for future form types

### Deliverables
- 1099-B extractor run schema (runs, pages, page results, exports)
- Source picker for upload vs existing document
- Dual-pane review UI with page status and Reviewed controls
- Summary page + recent runs list
- Transaction normalization layer
- TXF exporter validated against reference files
- Architecture doc for future form reuse

### Dependencies
- Intake/OCR flow in place
- Existing document library/query path available
- Access to existing Electron app logic and user-provided TXF examples
- Canonical per-page transaction schema defined

### Exit criteria
- User can start a 1099-B run from upload or an existing document
- User can review completed pages before the entire run finishes
- TXF output excludes unreviewed pages and reflects final user edits

---

## Phase 6 — Hardening / Deployment

### Goal
Make the app reliable, maintainable, and easy to deploy/update in the office.

### Milestones
- Production-ready Docker image
- Unraid template created
- Backup/restore procedures documented
- Logging, health checks, and error handling improved
- Release/update workflow from GitHub documented

### Deliverables
- Unraid template XML
- Deployment guide
- Health endpoints and container health checks
- Logging and failure visibility
- Database backup/restore procedure
- Security review checklist
- Smoke-test script for releases

### Dependencies
- Core workflows implemented
- Production storage/database settings understood
- Update strategy agreed (manual image pull / registry / CI build flow)

### Exit criteria
- App can be deployed on Unraid using documented steps
- A repeatable update path exists from GitHub to Docker deployment

---

## Cross-cutting principles

- Keep the UI compact, fast, and operator-friendly
- Prefer deterministic rules first, AI second, for tax-document handling
- Never silently auto-file uncertain client/document matches
- Preserve originals and keep all state changes auditable
- Update docs continuously as architecture and implementation evolve
- Use subagents for deeper implementation slices, then review and merge centrally

## Suggested build order

1. Finish OCR pipeline hardening enough for reliable source documents
2. Build the shared Tool run model and 1099-B Extractor shell
3. Implement page-level extraction + dual-pane review
4. Implement TXF export from Reviewed pages only
5. Add optional client linkage once Clients work exists
6. Generalize the extractor scaffold for future forms
7. Hardening / Deployment

## Progress tracking

### Completed
- [x] Repo created
- [x] Initial scaffold folders created
- [x] Core planning docs created
- [x] Docker base image + app bootstrap
- [x] MariaDB schema + migrations
- [x] Auth + bootstrap admin
- [x] Settings persistence + admin settings UI
- [x] Manual intake job/document foundation
- [x] Watched-folder worker loop + placeholder job processing
- [x] Review queue + document detail editing UI/API
- [x] Unraid first-run deployment/test documentation
- [x] Review workflow
- [x] Unraid template
- [x] 1099-B extractor blueprint / locked decisions documented

### In progress / next
- [ ] OCR pipeline
- [ ] Tool run data model for form extractors
- [ ] 1099-B source picker (upload + existing document)
- [ ] Progressive page extraction / partial review flow
- [ ] Dual-pane page review + Reviewed page certification
- [ ] TXF exporter wired to Reviewed-page final edits only
- [ ] Recent runs + summary page
- [ ] Reference TXF fixture validation
- [ ] Client filing

### Deferred / after initial 1099-B tool
- [ ] Optional client association inside tool runs
- [ ] Reusable form-tool scaffold for future forms beyond 1099-B
