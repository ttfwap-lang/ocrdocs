# Plan: finish identity population in ocr.local

## Where things stand (measured, not declared)

| Thing | State | Evidence |
|---|---|---|
| LlamaParse bulk run | **Complete** — 5,110/5,110 files have a terminal verdict (4,080 ok / 809 fatal / 221 two-strike) | `results\resume.log` = `ALL DONE`; per-file last-row audit |
| Corpus in app DB | **Complete** — 1,443 docs, 13,404 fields, 0 dup hashes, 0 empty corpus fields | `data/app.db` audit |
| Identity grouping | **Working** — 149 identities, family-name-first, catalogue-ordered breakdown | live `GET /api/identities` |
| Document bytes | **Serving** — HTTP 206 `application/pdf` from Recovered_C | live ranged GET |
| Identity photos | **Missing** — 0 photos; corpus index format is incompatible with `headshotService` | live API returns `photos: 0` |
| Unassigned docs | 1,134 docs have fields but no `family_name`+`date_of_birth` pair on the latest extraction | `listUnassigned` |

## Phase 1 — Identity photos (highest value, fully deterministic)

**1.1 Write `scripts/build_headshots_index.py`**
Converts the desktop nested corpus index into the app's flat format, writing
`<headshotsRoot>/index.jsonl` plus the crop tree. This is a converter, never a mutation:
no crop is moved, copied or deleted.

Per corpus record with faces:
- `docId` = app document whose `original_path` matches `record.file` (normcase + abspath)
- `identityId` = sha256(`normalizeText(family)|normalizeText(given)|normalizeDob(dob)`)[:16]
  computed from the app's **own** extraction fields using first-match semantics — must match
  `identityService.ts` exactly (an offline reference implementation already validated at
  309 docs -> 149 identities)
- `subdir` = first path segment of the crop's `path` (`applicant_Aihua_Chen`, `unassigned_applicant`)
- `headshots[]` = `{crop, relPath: path, bbox, verified, page}` with `page` lifted from the crop
  (the app reads page per-record, the corpus stores it per-crop)
- Skip records with no matching document; never invent a document.

Acceptance: `index.jsonl` parses; every `relPath` resolves to a real file; the recomputed
`identityId` set is a subset of the app's 149.

**1.2 Point the app at the converted headshots root**
`server.ts` already honours `OCRDOCS_HEADSHOTS_DIR`. Set it to the converted directory; no code
change needed. Decide the delivery shape (junction vs env var) and record it.

**1.3 Verify over live HTTP**
- `/api/identities` shows `photoCount > 0` and a `thumbnailUrl` for the expected identities
- `/api/identities/:id` returns `photos[]` with working `/headshots/...` URLs
- `GET` a thumbnail returns 200 `image/jpeg`
- Expected ceiling from the measured analysis: **26 of 149 identities, 64 verified crops**.
  Anything materially below that is a mapping bug, not a data limit.

## Phase 2 — Recover unassigned documents (the 1,134)

These documents are in the app and have extracted fields, but the latest extraction lacks
`family_name` or `date_of_birth`, so `buildGroups` refuses to guess. Never weaken that rule;
instead give it better inputs.

**2.1 Diagnose first** — classify the 1,134:
- has `family_name`, no DOB
- has DOB, no `family_name`
- has neither
- has a multi-subject extraction where the first-match field is the wrong subject (this is
  the real cause of the 185-vs-149 discrepancy found during verification: `Array.find` takes
  the first name/DOB, and multi-subject documents have several)

**2.2 Subject-aware grouping** — for documents whose fields carry a `subject`/section, prefer
the **applicant** subject's name+DOB over positional first-match. This is a correctness fix in
`identityService.ts`, needs its own tests, and should measurably raise the grouped count.
Gate it behind evidence from 2.1, not speculation.

**2.3 Non-identity documents** — many of the 1,134 are bank statements, tax returns, invoices
that legitimately have no person. Classify them as `document_type`-not-identity rather than
leaving them indistinguishable from a parse failure.

## Phase 3 — Close the loop on future files

The queue watcher is live and autonomous, but it currently parses and parks output; nothing
feeds new results into the app. Add:
- a post-parse step that runs `load_corpus_into_app.py` semantics over the watcher's
  `llamacloud_results.jsonl` (it is already idempotent and dedupes by content hash)
- the same headshot pre-filter output feeding `build_headshots_index.py`

## Sequencing and risk

- Phase 1 is additive and reversible (a generated index file), so it ships first and alone.
- Phase 2.2 touches live grouping logic: separate commit, its own tests, and a before/after
  identity count recorded in `STATE.md`.
- Never commit `data/`, `Recovered_C`, headshot crops, or extraction JSONL — all gitignored.
- Nothing is ever deleted; quarantine-and-review only.
- Rotate the LlamaCloud key (`llx-UJF...`) before the watcher's next send.
