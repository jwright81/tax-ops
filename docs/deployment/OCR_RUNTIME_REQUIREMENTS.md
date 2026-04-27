# OCR Runtime Requirements

## Purpose

`tax-ops` ships with OCRmyPDF/Tesseract bundled in the container image, with an OCR command override available for advanced setups.

Default setting:

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

The current codebase is wired for OCR command execution inside the container image, with an advanced override still available if you need to swap the command.

### Default — bundled OCR stack
OCRmyPDF/Tesseract are expected to be present in the image.

### Advanced — override the OCR command
Useful only when you intentionally need a different OCR command inside the container.

## Expected settings

- `ocr_mode=external`
- `ocr_command=/opt/ocrmypdf-venv/bin/ocrmypdf --deskew --rotate-pages --jobs 1 --skip-text --sidecar "{sidecar}" "{input}" "{output}"`
- `ocr_output_folder=/data/processed/ocr`
- Treat `ocr_command` as an advanced override; the bundled image path should work without host-installed OCR tools.

## Live-test note

These defaults were intentionally aligned with the known-good `ocrmypdf-auto` behavior after live testing. The worker still reads the sidecar internally for `documents.extracted_text`, then deletes the sidecar file so no `.txt` artifact remains visible to users.

## Validation command examples

Run inside the runtime/container if needed:

```bash
which ocrmypdf
which tesseract
which qpdf
```

If any of those are missing, OCR execution will fail.
