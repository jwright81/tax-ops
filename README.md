# tax-ops

Tax-ops is a compact internal web app for tax-office document intake, OCR, classification, review, and client filing workflows. It is designed for small-office deployment, with local development at home and production deployment on Unraid at the tax office.

## Goals

- Reduce manual document handling during tax season
- Monitor scanned-document intake from a NAS folder
- OCR and normalize scanned PDFs so they become searchable and reviewable
- Classify and split multi-document scan packets into tax forms
- Organize documents into client/year folders with safe naming rules
- Support admin-managed users and audit-friendly office workflows
- Reuse existing 1099-B to TXF conversion logic inside the new web app

## Product shape

Tax-ops is being built as a single deployable Docker app containing:

- **Web UI** for staff workflows
- **API server** for auth, metadata, and operations
- **Worker pipeline** for OCR, PDF prep, and classification jobs

The frontend and backend will ship together in one image for simple deployment and updates.

## Key decisions already made

- **Repo name:** `tax-ops`
- **GitHub repository:** `https://github.com/jwright81/tax-ops`
- **Container registry image:** `ghcr.io/jwright81/tax-ops:latest`
- **UI style:** compact, modern, Linear-style
- **Database:** MariaDB
- **Auth:** admin-managed users with first-run bootstrap admin
- **Deployment:** single Docker container
- **Target hosts:** home lab for development, tax-office Unraid for production
- **Filenames:** append SSN last4 when confidently extracted, e.g. `2025 W-2 - Employer ABC - John Smith (1234).pdf`
- **Execution model:** project planning and larger implementation tasks will be delegated to subagents throughout development

## Proposed stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui

### Backend
- Node.js
- TypeScript
- Fastify or Express
- Background job processing inside the same container process set

### Data + storage
- MariaDB
- Mounted storage paths for incoming, review, processed, and client-filed documents

### OCR / PDF pipeline
- OCRmyPDF
- Tesseract
- PDF tooling such as PyMuPDF, pikepdf, qpdf, or Ghostscript where needed

## Core workflows

### 1. Intake
- Monitor a mounted NAS folder for newly scanned PDFs
- Copy originals into an app-managed intake area
- Create processing jobs and preserve source files

### 2. OCR + prep
- Detect and correct page rotation
- OCR scanned PDFs into searchable PDFs
- Extract text and per-page metadata
- Generate thumbnails/previews for review

### 3. Review + classification
- Detect likely document types such as W-2, 1099 variants, brokerage statements, and other tax forms
- Split one packet into multiple logical documents when needed
- Extract taxpayer/spouse names and identifying metadata
- Send uncertain cases to a review queue rather than auto-filing blindly

### 4. Client filing
- Suggest client matching based on names, SSN last4, year, payer/broker, and packet context
- Apply naming rules
- Move approved documents into client/year folders

### 5. 1099-B / TXF tools
- Reuse the existing 1099-B AI parsing/conversion logic
- Expose it as a workflow in the web app
- Generate TXF output for downstream tax software import

## User management

Tax-ops will support:

- First-run bootstrap admin account
- Forced password change on first login
- Admin-only user add/edit/delete/disable flows
- Role-based access starting with `admin` and `staff`
- Audit logs for sensitive actions

## Configuration

Configuration will be driven by environment variables first, with selected operational settings stored in the database for admin management later.

Expected configuration areas:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `WATCH_FOLDER`
- `PROCESSED_FOLDER`
- `REVIEW_FOLDER`
- `CLIENTS_FOLDER`
- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD`
- app secrets such as JWT/session keys

The app should store relative document paths in the database where possible so deployment between home and office environments stays portable.

## Repository + release references

- **Source repository:** `https://github.com/jwright81/tax-ops`
- **Container image:** `ghcr.io/jwright81/tax-ops:latest`
- **Unraid template source:** `https://raw.githubusercontent.com/jwright81/tax-ops/main/unraid/tax-ops.xml`
- **Release/update path:** push changes to `main`, then use the GitHub Actions workflow in `.github/workflows/publish-image.yml` to publish the updated image to GHCR.

## Deployment targets

### Home lab
Used for development and testing against local Unraid-hosted MariaDB and storage shares.

### Tax office
Primary production target. The app should run as a single Docker container with mounted volumes and support an Unraid template for easy deployment and updates.

## Phased roadmap

### Phase 1 — Foundation
- repo bootstrap
- app shell
- MariaDB schema baseline
- auth and admin user management
- Docker build and run path

### Phase 2 — Intake + OCR
- watched-folder intake
- OCR pipeline
- PDF rotation/normalization
- metadata extraction
- manual intake job creation UI/API already scaffolded as a stepping stone toward automated watched-folder intake
- worker now includes watched-folder scan + placeholder OCR/classification loop so intake records can advance to a review state
- documents now track OCR status/provider, extracted text, and review notes for a more realistic review workflow
- UI now surfaces OCR readiness guidance and first Unraid-side validation steps for the bundled OCR stack

### Phase 3 — Review + classification
- review queue
- form classification
- page grouping/splitting
- correction UI

### Phase 4 — Client filing
- client matching suggestions
- naming rules
- filing workflow and folder placement

### Phase 5 — 1099-B / TXF integration
- extract reusable conversion logic from the existing Electron app
- expose 1099-B processing in the web UI
- generate TXF output

### Phase 6 — Hardening + deployment
- logging and health checks
- backup/restore guidance
- Unraid template
- release/update workflow from GitHub

## Repo documentation

This repository will maintain living docs for planning and implementation:

- `README.md` — project overview and operating assumptions
- `PROJECT_STRUCTURE.md` — canonical repo layout and file responsibilities
- `IMPLEMENTATION_PLAN.md` — phased build plan with progress tracking
- `docs/deployment/UNRAID_FIRST_RUN.md` — first practical Unraid deployment and validation checklist
- `docs/deployment/OCR_RUNTIME_REQUIREMENTS.md` — OCR binary/runtime requirements and advanced command override notes for the container-bundled OCR stack

These docs should be updated as decisions change and as project phases are completed.

## Current bootstrap status

Current scaffold in repo:

- base workspace folders for web, server, worker, shared code, docs, scripts, and deployment assets
- React + TypeScript + Vite + Tailwind web foundation with compact dashboard shell
- TypeScript API scaffold with MariaDB config, migrations, bootstrap admin seeding, login endpoint, and admin user-management endpoints
- TypeScript worker scaffold for intake/OCR runtime, now with watched-folder discovery and placeholder processing flow
- React admin UI for login, current session view, user management, settings, manual intake job creation, OCR/runtime guidance, and review queue/detail editing
- shared package for env schema, auth types, and document filename builder
- single-container Docker entrypoint that starts worker + server and serves built frontend assets
- development compose file
- starter Unraid template XML
