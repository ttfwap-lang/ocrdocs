# vlm_v2 pipeline (Paddle-VL + TrOCR + Chandra + Qwen3-VL)

Status: **code complete and unit-tested, not yet deployed or measured on real pages.** `OCRDOCS_PIPELINE` defaults to
`legacy`; nothing changes until it is set to `vlm_v2` on the worker. The DenseNet-121 page triage is written
(`scripts/ocr_triage.py`) but has no trained weights, so the page kind currently comes from the Qwen classifier.

## Flow

```mermaid
flowchart TD
    A["Upload or import file"] --> T{"File type"}
    T -->|"docx txt xml json"| TXT["Direct text"]
    T -->|"pdf and images"| G0["Render pages, native PDF text layer"]
    G0 --> S1["S1 probe (OCRDOCS_GATES)<br/>Tesseract 100 DPI, OSD orientation, rotate upright"]
    S1 --> CL["Classify page: Qwen3-VL<br/>printed / handwritten / both / blank / photo"]
    CL --> S2{"S2 regex clear (OCRDOCS_GATES)<br/>all printed, good probe text,<br/>zero catalogue matches?"}
    S2 -->|"yes, not audit sampled"| PARK["Cleared: stored with probe text + reason<br/>2 percent audit sample read anyway"]
    S2 -->|"no"| RD
    subgraph RD["S3 read"]
        direction LR
        P["PaddleOCR-VL 1.6<br/>printed and both"]
        TR["Tesseract lines + TrOCR large<br/>handwritten and both"]
    end
    RD --> M["Qwen3-VL merge<br/>fields, owner, section, entry, document type"]
    M --> S4{"S4 question flags<br/>any rule fires?"}
    S4 -->|"no"| OUT
    S4 -->|"yes"| CH["Chandra 2 second reader (OCRDOCS_CHANDRA)<br/>flagged printed pages"]
    CH --> AG["S5 agent verifier (OCRDOCS_AGENT)<br/>tools: read_region trocr/paddle/chandra,<br/>validate, page_text"]
    AG --> OUT["Worker result: text, pages, vlmFields, documentType, review"]
    TXT --> OUT
    OUT --> SV["Server: regex validates Qwen values,<br/>owner routing, agent annotations"]
    SV --> REV["Human review: warnings, flags, agent reasoning"]
    REV --> ID["Identity grouping, export"]
```

Every stage that cannot run degrades to "send it to a human": Paddle down falls back to Tesseract for that page,
Qwen down means "read it with everything" and no merge, Chandra or the agent down leaves the flags standing.

## Rules that protect real data
- **S2 parks, never deletes.** Only a file whose pages are all printed, whose probe read enough good text, and that
  matches no catalogue label or value shape is parked. Handwriting is never judged by the probe (Tesseract cannot read it).
  A fixed 2 percent of parked files (`ocr_gates.AUDIT_RATE`, chosen by document name) are read in full anyway, so the miss rate is measurable.
- **Qwen is not trusted with digits.** A value whose digits no OCR engine read is flagged and given low confidence
  (`ocr_qwen_merge`), and on the server it never overrides a regex reading.
- **Owner routing.** Only applicant-owned values fill the catalogue fields identities group on. A parent's or referee's
  value becomes its own field (`Parent 2: Given Names`), a missing owner is always a warning, and a regex hit that
  matches only another person's value is downgraded (`server/services/vlmFieldMerge.ts`).
- **The agent cannot invent a correction.** In code (`ocr_agent_verify._settle`), a correction is accepted only if it
  cites a region and its value appears in something a reader produced; confirmed digits must be found in a reading or
  the stored text; otherwise the verdict becomes `unresolved` for a human. Budgets: 8 steps, 10 tool calls, 180 s.

## Switches (worker environment)

| Variable | Default | Effect |
|---|---|---|
| `OCRDOCS_PIPELINE` | `legacy` | `vlm_v2` enables everything below |
| `OCRDOCS_GATES` | `false` | S1 probe + orientation and S2 clear |
| `OCRDOCS_CHANDRA` | `false` | Chandra second reader on flagged printed pages |
| `OCRDOCS_AGENT` | `false` | S5 agent verifier on flagged files |
| `OCRDOCS_PADDLE_URL` | `http://localhost:8100` | Paddle-VL endpoint |
| `OCRDOCS_QWEN_URL` / `OCRDOCS_QWEN_MODEL` | `http://localhost:8200` / `qwen-vl` | classify, merge |
| `OCRDOCS_CHANDRA_URL` | `http://localhost:8300` | Chandra endpoint |
| `OCRDOCS_AGENT_URL` / `OCRDOCS_AGENT_MODEL` | Qwen URL / model | agent chat endpoint |
| `OCRDOCS_TRIAGE_WEIGHTS` | unset | DenseNet triage weights (module written, not wired) |

## Stack

```mermaid
flowchart LR
    subgraph GX["GX10 (GB10, aarch64, 128 GB shared)"]
        direction TB
        SRV["ocrdocs-server<br/>Express + dashboard + SQLite"]
        WK["ocrdocs-worker (venv)<br/>engine, Tesseract, TrOCR-large"]
        subgraph VL["vLLM containers via scripts/vllm_services.sh"]
            PV["paddle-vl :8100<br/>PaddleOCR-VL 1.6"]
            QV["qwen-vl :8200<br/>Qwen3-VL-8B"]
            CV["chandra :8300, on demand<br/>Chandra OCR 2"]
        end
    end
    SRV -->|"job claim"| WK
    WK -->|"text, pages, vlmFields, review"| SRV
    WK --> PV
    WK --> QV
    WK --> CV
```

## Runbook (each restart needs the owner's OK)
1. `scripts/vllm_services.sh fetch qwenvl` (Qwen3-VL-8B is not on the box yet), then `start paddle`, `start qwenvl`.
   Each start refuses to run without enough free memory. Chandra needs ~48 GB free: start it only when `OCRDOCS_CHANDRA=true`.
2. Deploy scripts with `scripts/gx10_deploy.sh` (its import check now covers every new module).
3. Add the env vars above to the worker drop-in (`runtime.conf`), `systemctl daemon-reload`, restart `ocrdocs-worker` only.
4. Smoke test: upload one handwritten form; check `pages[]` kinds and engines, merged fields, and `review.flags` in the
   extraction metadata. Then run a few dozen files with gates OFF, read the flag rates (`ocr_question_score.flag_rates`),
   and only then turn on gates, Chandra and the agent one at a time.
5. **Rollback:** `OCRDOCS_PIPELINE=legacy`, restart the worker. No migration is involved; everything new lives in
   `extraction_json`.

## Not yet done
- Real-page evaluation: graded digit accuracy of Paddle vs Chandra vs TrOCR vs Qwen on BSB, account number and DOB.
- `vllm_services.sh` has been syntax-checked only; it has not started a container on the GX10. The Qwen3-VL-8B launch
  flags (memory fraction, quantization) are unmeasured.
- DenseNet-121 triage needs labelled pages and training; until then the Qwen classifier decides the page kind.
- Chandra's weights are modified OpenRAIL-M (free below $2M funding/revenue, not for competing with the vendor's API):
  confirm this fits before running it on production data.
