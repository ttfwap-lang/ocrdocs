# E2E analysis plan: Medicare page + expiry rule

Status: the owner's expiry rule is IMPLEMENTED and VERIFIED. This document records what was
measured, the five defects found during the E2E pass, and what remains.

## 1. The rule, and where it is enforced

> The expiry of interest is only ever `MM/YY` or `MM/YYYY`, and only ever within
> `09/2026` to `09/2031` inclusive. Every other detected expiry is incorrect and
> therefore irrelevant. No exceptions.

Single source of truth: `src/utils/medicareExpiry.ts` — in `src/utils` because the server
importer and the browser component both consume it, so the page and the database cannot
disagree about what is real.

Enforced in five places, deliberately, because a rule applied in only one of them lets the
page contradict itself:

| Layer | Mechanism |
|---|---|
| Import | `syncMedicareIndex()` clears any rejected value before storing it |
| Storage | `expiry_best_date` only ever holds a value that passed; boundaries land on 09/2026 / 09/2031 |
| Search | `search_blob` indexes the canonical value, so a rejected expiry is not even findable |
| Render | `displayExpiry()` re-checks defensively; the raw-value fallback is gone |
| Export | the CSV carries one `expiry` column in `MM/YYYY`; `expiry_best_raw` / `expiry_tokens` are no longer emitted |

## 2. Measured outcome on the real corpus (3,592 rows)

| Outcome | Count | Share |
|---|---:|---:|
| Valid (in window) | 474 | 13.2% |
| Rejected — before 09/2026 | 49 | 1.4% |
| Rejected — after 09/2031 | 16 | 0.4% |
| No expiry detected | 3,053 | 85.0% |
| **Total rejected** | **65** | **1.8%** |

Full-DB audit after import: 0 malformed, 0 out-of-window, 474 stored,
`has_expiry = 1` count agrees with the stored non-empty count, earliest month exactly
2026-09, latest exactly 2031-09.

The source has more format variety than expected (`2027-02-28`, `2030-09`, `2027-04`);
the rule reads all of them and canonicalises to `YYYY-MM-01`.

## 3. Defects found and fixed in this pass

1. **False "expired" count.** The rule is month-granular but the store pins the day to
   `01`, so a `09/2026` card read as expired 23 days ago on the 24th. Measured:
   `expired` 10 → 0, `expiringSoon` 68 → 78. Now whole-month everywhere.
2. **The CSV export leaked rejected expiries** via `expiry_best_raw` / `expiry_tokens`.
3. **CSV formula-injection risk** — the header row was unescaped while the rows were
   escaped. The index holds 45 real values beginning with `=`, `+`, `-` or `@`
   (42 in `diagnoses`, 3 in `address_full`), which Excel/Sheets run as formulas.
4. **The page claimed something false** — "nothing is dropped" stopped being true when
   the rule started clearing values. Copy now states the rule and the clearing plainly.
5. **Dead/misleading code** — `expiryWithIsoDate` duplicated `withExpiry`; the
   "Expiry unresolved" filter can never match; `daysUntil()` became unused. All removed.

## 4. A real bug in the import guard

The import is guarded by a fingerprint of the source JSON. Because the JSON was
byte-identical when the rule changed, the guard **skipped the re-import** and the page
kept serving values the new code would reject — the tightening appeared to do nothing.
The fingerprint now covers an import rule version as well as the JSON
(`MEDICARE_IMPORT_RULE_VERSION = 2`), so any future rule change always re-imports.
Without this, every future rule change would be silently defeated.

## 5. Outstanding: a pre-existing failure, unrelated

`tests/python/test_ocr_vlm_engine.py::test_page_document_type_flows_from_the_merge_into_the_file_result`
fails. It is **pre-existing** — it fails identically on a clean `HEAD` with all my work
stashed, and none of my files touch the VLM engine. Not fixed and not hidden here; it
belongs to the `vlm_v2` pipeline work and should be triaged on its own.

## 6. Refinement backlog (not yet done)

Structural:
- [ ] **PHI trust boundary is unstated.** `/api/identities` is documented as carrying PHI
      and the medicare routes have no auth. That is consistent with this project's
      deliberate "no dashboard login" decision, but the medicare surface is far more
      sensitive (Medicare number, MRN, phone, email, address per patient) and deserves an
      explicit decision plus a note, rather than inheriting the identities precedent by
      accident.
- [ ] No `expiry` index is exercised by a filter test; the month-granularity SQL
      (`start of month`, `+4 months`) has no regression test against a fixed clock.
- [ ] `readExpiryCensus()` re-reads and re-parses the 3.3 MB JSON on every summary
      request. Fine for a dashboard, wasteful under repeated polling — cache by
      fingerprint.

Visual / UX:
- [ ] The expiry column mixes the `MM/YYYY` value and the relative suffix (`2mo`,
      `this mo`) at different sizes in the same cell; consider aligning the baseline.
- [ ] "Expiry in window" and "Expiry rejected" tiles are informational only, but six
      other tiles are clickable filters. A non-clickable tile among clickable ones reads
      as broken. Either make them filterable (e.g. "rejected" needs a stored flag to be
      filterable, which the clear-only decision currently forbids) or visually mark them
      as read-only.
- [ ] The 8-tile grid drops to 2 columns on mobile; the two expiry tiles are adjacent and
      read as a pair, which is good, but "Expiring <=3mo" between them breaks the grouping.
- [ ] `loadedAt` is rendered as `new Date(summary.loadedAt + 'Z')`. SQLite's
      `datetime('now')` yields `YYYY-MM-DD HH:MM:SS` with a space, not `T`; this parses
      today but relies on lenient parsing. Worth an explicit ISO conversion.

Data quality:
- [ ] 85% of rows have no expiry at all. Worth confirming with the upstream pipeline
      whether that is genuine (no card present) or an extraction gap.
- [ ] `expiry_best_precision` is still exported even though the rejected values it
      described are gone; it may now be noise.
