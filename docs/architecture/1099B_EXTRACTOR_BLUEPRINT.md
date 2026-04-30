# 1099-B Extractor blueprint

## Purpose

The **1099-B Extractor** is the first major tool under `Tools`. It turns brokerage 1099-B PDFs into a page-reviewed extraction workflow and TXF export, while establishing a reusable pattern for future form-specific tools.

## Locked product decisions

- **First tool:** 1099-B Extractor ships before other major Tools.
- **No client required initially:** a run can exist without a client. Client linkage becomes optional once Clients work exists.
- **Two document sources:** users can start from either:
  - a local PDF upload, or
  - an already-ingested TaxOps document, especially items classified as `1099-B`.
- **Streaming review:** users can begin reviewing processed pages while AI continues extracting the remaining pages.
- **Page-level certification:** a page is considered trusted for export only after the user marks it **Reviewed**.
- **TXF export rule:** generated TXF must use the final edited values from all pages marked Reviewed, including user edits/additions/deletions in the right pane.
- **Generalized architecture:** 1099-B is the first form, but the workflow should be form-agnostic so future tools mostly swap the AI prompt and structured output schema.
- **Reference TXF samples:** the user supplied working TXF output files that should be kept as export/reference fixtures during implementation and validation.

## UX blueprint

### Entry points

1. **Tools > 1099-B Extractor**
2. Start from:
   - **Upload PDF**
   - **Select existing TaxOps document**

For existing documents, the picker should surface admin-managed document names/types and prioritize docs already classified as 1099-B.

### Primary run flow

1. Create extractor run
2. Detect source metadata where possible:
   - broker / payer
   - client or taxpayer name when visible
   - account number / account label
   - tax year
   - page range candidates
3. Queue page extraction jobs
4. Show the review UI immediately
5. As each page finishes:
   - left pane shows the page preview
   - right pane shows extracted structured rows/fields
   - user can edit, add, or delete extracted values
   - user marks the page **Reviewed** when the right pane is correct
6. When enough pages are reviewed, user can generate/export TXF from reviewed pages
7. Final summary page shows run totals, reviewed status, warnings, and export actions

### Review UI expectations preserved from prior notes

- dual-pane review layout
- page-by-page AI extraction
- page navigation with per-page status
- summary page before/after export
- recent runs list
- broker/client/account metadata detection
- page range selection
- obvious distinction between processed, reviewing, reviewed, and flagged pages

## Functional model

### Core entities

- **ToolRun**
  - tool type (`1099-b-extractor`)
  - source kind (`upload` or `existing_document`)
  - source document reference
  - optional client reference
  - overall status
  - detected metadata snapshot
- **ToolRunPage**
  - page number
  - extraction status
  - review status
  - preview/text pointers
  - warnings/errors
- **ToolRunPageResult**
  - structured extracted payload for one page
  - normalized transaction rows + supporting fields
  - edit history/audit trail
- **ToolExport**
  - export type (`txf`)
  - generation inputs summary
  - output file reference

### Processing behavior

- Page extraction jobs run independently so completed pages become reviewable immediately.
- A run can remain in progress while some pages are already marked Reviewed.
- Re-processing a page should replace the machine extraction but preserve audit history of user edits/review actions.
- TXF generation should filter to **Reviewed** pages only.

## Generalized tool architecture

Build the extractor as a reusable pipeline:

1. **Tool definition**
   - tool id, title, supported source types
2. **Form extraction config**
   - AI prompt template
   - structured output schema
   - page-level normalization rules
   - export adapters available for that form
3. **Shared review shell**
   - source selection
   - run lifecycle
   - page queue/progress
   - dual-pane editor
   - reviewed/page certification state
   - summary/recent-runs views
4. **Form-specific adapters**
   - 1099-B transaction extraction
   - TXF export mapping

For future forms, most work should be limited to the extraction prompt/schema plus any form-specific export or summary logic.

## Implementation slice

### Backend

- Add tool run tables for runs, pages, page results, and exports
- Support run creation from upload or existing document reference
- Add page job orchestration so pages process independently
- Store detected metadata separately from user-corrected values
- Add TXF export service that reads only reviewed page results

### Frontend

- Add Tools landing state with 1099-B Extractor as first major card
- Build source selection flow for upload vs existing doc
- Build run workspace with dual-pane page review
- Show live processing progress so review can start before the run completes
- Add summary page + recent runs list

### Validation

- Compare generated TXF output against user-provided reference TXF files
- Verify edits/additions/deletions survive into export
- Verify unreviewed pages are excluded from TXF output

## Out of scope for first implementation

- mandatory client assignment
- broad multi-form extractor library beyond the shared scaffold needed for 1099-B
- final automation of filing extracted data back into client workflows
