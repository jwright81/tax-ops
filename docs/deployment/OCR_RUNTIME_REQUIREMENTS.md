# OCR Runtime Requirements

## Purpose

`tax-ops` ships with OCRmyPDF/Tesseract bundled in the container image. OCR behavior is now stored as structured settings in the app instead of a single freeform command override.

Default internal command preview:

```bash
/opt/ocrmypdf-venv/bin/ocrmypdf --deskew --rotate-pages --jobs 1 --skip-text --sidecar "{sidecar}" "{input}" "{output}"
```

This means the container environment already provides the command and its core dependencies by default.

## Required binaries

For the bundled OCR path, expect:

- `ocrmypdf`
- `tesseract`
- `qpdf`

Additional dependencies may be required depending on base image/package source.

## Container note

The current codebase is wired for OCR command execution inside the container image when `ocr_mode=internal`.

### Default — bundled OCR stack
OCRmyPDF/Tesseract are expected to be present in the image.

### External mode
External mode is a first-pass foundation only right now: the setting is saved and visible, but automatic external folder handoff/import is not fully wired yet.

## Expected settings

- `ocr_mode=internal`
- `ocr_deskew=true`
- `ocr_rotate_pages=true`
- `ocr_jobs_enabled=true`
- `ocr_jobs=1`
- `ocr_skip_text=true`
- `ocr_sidecar=true`
- `ocr_rotate_pages_threshold_enabled=false`
- `ocr_rotate_pages_threshold=14.0`
- `ocr_clean=false`
- `ocr_clean_final=false`

## Live-test note

These defaults were intentionally aligned with the known-good `ocrmypdf-auto` behavior after live testing. When sidecar is enabled, the worker reads it into `documents.extracted_text` and then deletes the temporary `.txt` file. When sidecar is disabled, the worker does not fabricate extracted text.

## Validation command examples

Run inside the runtime/container if needed:

```bash
which ocrmypdf
which tesseract
which qpdf
```

If any of those are missing, OCR execution will fail.
