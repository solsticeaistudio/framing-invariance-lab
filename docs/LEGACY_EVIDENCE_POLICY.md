# Legacy Evidence Policy

V1.4, v1.5, and v1.6 run JSON remains readable through the legacy canonicalizer and conservative normalization. Migration never rewrites the source: it previews, creates an exclusive backup, writes a v2 destination, records each transformed/preserved/unavailable field, computes source/destination hashes, downgrades unsupported tiers, and signs a migration attestation.

Facts never stored cannot be reconstructed. Missing signer identity, pack custody, signed plan, or secondary-selection state remains explicitly unknown. A historical holdout label does not become trusted. Unsigned legacy evidence can be imported as exploratory context but cannot receive v2 validated, confirmed, or independently confirmed study tiers.

```text
npm run migrate:v2 -- --dry-run old-run.json
npm run migrate:v2 -- old-run.json migrated/run.json
npm run migration:verify -- --source old-run.json --destination migrated/run.json --report migrated/run.json.migration.json
npm run rerun:plan -- migrated/run.json
```

Higher evidence status is regained only through a v2 rerun or newly linked independently verifiable evidence. The rerun plan preserves usable configuration while naming the trust facts that must be re-established.
