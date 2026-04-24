# Unraid First Run Guide

This guide walks through the first practical deployment and validation run for `tax-ops` on Unraid.

## Goal

Validate the full first-pass flow:

1. container starts
2. app connects to MariaDB
3. bootstrap admin login works
4. watched folder is readable
5. worker creates a job from a scanned PDF
6. OCR step runs (or fails clearly)
7. document appears in review UI

---

## 1. Prerequisites

Before deploying, confirm you have:

- Unraid server with Docker enabled
- MariaDB already running and reachable from the `tax-ops` container
- a writable share/path for tax document storage
- GitHub access to this repo: `https://github.com/jwright81/tax-ops`

### MariaDB requirements

Create a database and user for tax-ops, or reuse an existing MariaDB server with a dedicated DB/user.

Recommended values:

- DB name: `tax_ops`
- DB user: `tax_ops`
- DB password: set your own secure password

---

## 2. Required storage paths

Recommended Unraid paths:

- App data root: `/mnt/user/appdata/tax-ops/data`
- Incoming scans: `/mnt/user/appdata/tax-ops/data/incoming`
- OCR output: `/mnt/user/appdata/tax-ops/data/processed/ocr`
- Review output: `/mnt/user/appdata/tax-ops/data/review`
- Client docs: `/mnt/user/appdata/tax-ops/data/clients`
- Originals: `/mnt/user/appdata/tax-ops/data/originals`

Create these folders before first test if they do not already exist.

---

## 3. OCR runtime requirement

If using real OCR mode, the runtime must include:

- `ocrmypdf`
- `tesseract`
- `qpdf`

## Current state note

The app is already wired to call an external OCR command, but the current dev host does **not** have these tools installed.

That means your first real OCR test should happen on Unraid only **after** the runtime/container includes these packages.

If those tools are not yet available in the runtime, either:

- expect OCR jobs to fail clearly, or
- temporarily switch OCR mode away from external for UI-only testing

---

## 4. Unraid template values

Use or adapt the template at:

- `unraid/tax-ops.xml`

Set these values carefully:

### Required container values

- **Repository**: `ghcr.io/jwright81/tax-ops:latest` 
  - or use your preferred build/tag workflow if publishing another image path
- **Web UI Port**: `3000`
- **App Data**: `/mnt/user/appdata/tax-ops/data`
- **DB Host**: IP or hostname of MariaDB
- **DB Port**: usually `3306`
- **DB Name**: `tax_ops`
- **DB User**: `tax_ops`
- **DB Password**: your chosen DB password
- **Bootstrap Admin Username**: `admin`
- **Bootstrap Admin Password**: set a secure first-run password
- **Watch Folder**: `/data/incoming`
- **Processed Folder**: `/data/processed`
- **Review Folder**: `/data/review`
- **Clients Folder**: `/data/clients`

---

## 5. First login validation

After the container starts:

1. open the app in browser
2. log in with the bootstrap admin username/password
3. verify the dashboard loads
4. go to **Settings** tab
5. confirm settings exist in the UI

Check that these OCR settings are present:

- `ocr_mode`
- `ocr_command`
- `ocr_output_folder`

Recommended first values:

- `ocr_mode=external`
- `ocr_command=/opt/ocrmypdf-venv/bin/ocrmypdf --rotate-pages --deskew --force-ocr "{input}" "{output}"`
- `ocr_output_folder=/data/processed/ocr`

---

## 6. First watched-folder test

Drop one sample scanned PDF into:

- `/mnt/user/appdata/tax-ops/data/incoming`

Then verify:

1. a processing job appears in the dashboard
2. the worker picks it up
3. job status changes from:
   - `queued` → `processing` → `completed` or `failed`
4. a document record appears
5. document enters the **Review** queue or error state

---

## 7. Expected outcomes

### Success path

If OCR tools are present and runnable:

- job completes
- OCR provider is shown
- extracted text/review notes populate
- output file path updates
- document appears in review queue

### Failure path

If OCR tools are missing/misconfigured:

- job fails or document shows OCR error state
- error context appears in job/document notes
- this still counts as useful validation because it proves the pipeline path is wired correctly

---

## 8. First test checklist

- [ ] MariaDB reachable from container
- [ ] tax-ops container starts
- [ ] bootstrap admin login works
- [ ] settings page loads
- [ ] OCR settings visible
- [ ] watched folder mounted correctly
- [ ] sample PDF dropped into incoming folder
- [ ] processing job created
- [ ] document created
- [ ] review queue updates OR OCR failure is clearly visible

---

## 9. What to report back after first test

After the first Unraid run, capture:

- whether container started successfully
- whether login worked
- whether the sample PDF created a job
- whether OCR succeeded or failed
- any visible error text from dashboard/review/job status
- any container logs if startup fails

That will tell us exactly what the next implementation or deployment fix should be.
