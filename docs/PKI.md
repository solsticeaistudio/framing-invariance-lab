# Application PKI

Framing Invariance Lab v2 uses Ed25519 keys and application certificates. A configured self-signed root is the trust anchor; only an administrator can add it. Roots issue leaf certificates with one or more roles: `lab_operator`, `scenario_author`, `holdout_custodian`, `independent_evaluator`, `human_reviewer`, or `report_publisher`.

Certificate verification checks the full issuer chain, public-key fingerprint, validity at signing, current validity, required role, and signed revocation lists. Results distinguish valid, expired at signing, expired after signing, revoked before signing, revoked after signing, unknown issuer, invalid chain, and unauthorized role. Rotation creates a new key/certificate; historical artifacts retain their original chain and status.

```powershell
npm run keys:generate -- --out <secure-dir> --name root
npm run cert:create-root -- --private-key <secure-dir>/root.private.pem --public-key <secure-dir>/root.public.pem --certificate-id fil-root --subject "FIL Root" --organization "Example Lab" --roles lab_operator --valid-from 2026-01-01T00:00:00Z --valid-until 2036-01-01T00:00:00Z --out <secure-dir>/root.json
npm run cert:issue -- --issuer <secure-dir>/root.json --issuer-private-key <secure-dir>/root.private.pem --subject-public-key <secure-dir>/publisher.public.pem --certificate-id publisher-1 --subject "Report Publisher" --organization "Example Lab" --roles report_publisher --valid-from 2026-01-01T00:00:00Z --valid-until 2028-01-01T00:00:00Z --out <secure-dir>/publisher.json
npm run trust:add -- --trust <secure-dir>/trust.json --certificate <secure-dir>/root.json
```

`TRUST_ANCHOR_FILES`, `TRUST_CERTIFICATE_FILES`, and `REVOCATION_LIST_FILES` load approved public material. `SIGNING_PRIVATE_KEY_FILE` and holdout private-key variables point outside source control. Private keys are never database records or HTTP payloads.

An independence declaration is separately signed by an `independent_evaluator`. It binds the pack ID/hash, evaluator and custodian organizations, authorship, prior access, funding, conflicts, custody statement, and declaration time. This is cryptographically attributable testimony, not mathematical proof of independence.
