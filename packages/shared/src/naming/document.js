const clean = (value) => String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ');
export function buildDocumentFilename(parts) {
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
//# sourceMappingURL=document.js.map