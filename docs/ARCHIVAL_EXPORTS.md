# Archival Exports

Official PDF generation is server-side and accepts only an immutable signed report artifact. The renderer fixes page size, margins, fonts, locale-independent text, creation/modification dates, producer metadata, disclosure headers, page numbers, report hash, and signer fingerprint. It has no browser, script, filesystem, or network execution surface. Repeated invocations are byte-tested. Browser printing remains informal and nondeterministic.

Public PDFs repeat `RESPONSIBLE PUBLIC DISCLOSURE`; internal PDFs repeat `INTERNAL EVIDENCE` and require resource authorization.

Archives are deterministic ZIP files with sorted safe paths, normalized timestamps, fixed compression, per-entry SHA-256, `checksums.sha256`, and a signed `archive-manifest.json`. Public archives contain allowlisted public report/synthesis and public completed-run summaries. Internal archives can include authorized manifests and evidence CSV. Neither contains keys or credentials.

`npm run archive:verify -- archive.zip` rejects invalid signatures, missing/extra entries, checksum mismatch, path traversal, excessive entry count, and expansion limits. Offline verification uses the included certificate chain plus an administrator-provided trust anchor.
