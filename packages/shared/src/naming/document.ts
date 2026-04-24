interface FileNameParts {
  taxYear?: string | number | null;
  formType?: string | null;
  issuer?: string | null;
  clientName?: string | null;
  ssnLast4?: string | null;
}

const clean = (value?: string | number | null) =>
  String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ');

export function buildDocumentFilename(parts: FileNameParts) {
  const segments = [parts.taxYear, parts.formType, parts.issuer, parts.clientName]
    .map(clean)
    .filter(Boolean);

  let base = segments.join(' - ');
  const ssn = clean(parts.ssnLast4);

  if (ssn) {
    base += ` (${ssn})`;
  }

  return `${base || 'document'}.pdf`;
}
