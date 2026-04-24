interface FileNameParts {
    taxYear?: string | number | null;
    formType?: string | null;
    issuer?: string | null;
    clientName?: string | null;
    ssnLast4?: string | null;
}
export declare function buildDocumentFilename(parts: FileNameParts): string;
export {};
