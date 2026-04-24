# OCR Runtime Requirements

## Purpose

`tax-ops` currently supports an external OCR command execution path.

Default setting:

```bash
ocrmypdf --rotate-pages --deskew --force-ocr "{input}" "{output}"
```

This means the runtime environment must provide the command and its dependencies.

## Required binaries

For the default OCR path, install:

- `ocrmypdf`
- `tesseract`
- `qpdf`

Additional dependencies may be required depending on base image/package source.

## Container note

The current codebase is wired for OCR command execution, but the runtime image has **not yet been upgraded** to bundle OCR packages automatically.

So there are two paths:

### Path A — bundle OCR tools into the runtime image
Recommended for a smoother production deployment.

### Path B — use a runtime/container environment that already has OCR tools available
Useful for quick testing if you control the image or can extend it on Unraid.

## Expected settings

- `ocr_mode=external`
- `ocr_command=ocrmypdf --rotate-pages --deskew --force-ocr "{input}" "{output}"`
- `ocr_output_folder=/data/processed/ocr`

## Validation command examples

Run inside the runtime/container if needed:

```bash
which ocrmypdf
which tesseract
which qpdf
```

If any of those are missing, OCR execution will fail.
