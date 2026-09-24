# CodeSOTA review for the GX10 OCR path

**Review date:** 2026-09-24  
**Scope:** Australian financial/identity documents, local inference on the
GB10/GX10 (`aarch64`, `sm_121`, shared 128 GiB memory), with BSB, account
number and DOB exact match as the primary decision metrics.

## Executive decision

CodeSOTA does **not** provide evidence that makes a model swap safe or
automatic. Its registry mixes datasets, incompatible metrics, stale rows and
mostly unverified/vendor-reported results. The current codebase should keep its
local, evidence-preserving pipeline and should not silently replace it with a
VLM because of a generic leaderboard position.

The safe candidate order for a local bake-off is:

1. **PaddleOCR-VL-1.6 + PP-OCRv6/PP-StructureV3** as the primary local reader.
2. **LightOnOCR-2-1B** as an independent lightweight challenger.
3. **Qwen3-VL-4B-Instruct** as a constrained semantic/field second reader;
   test 8B only after measuring memory and latency.

These are test candidates, not an assertion that any one is best for
Australian digits. Critical numeric values must never be accepted from a
model without OCR/native-text evidence, bounding-box provenance and validation.
Human review remains mandatory for disagreements.

## Registry snapshots fetched

| Endpoint | `as_of` | `snapshot_id` | Limitation |
|---|---|---|---|
| `https://www.codesota.com/api/sota/handwriting-recognition?tier=sota` | `2020-08-29T00:00:00.000Z` | `reg-2020-08-29-3b81ac` | API pick is Bengali isolated-character cross-entropy, not English form/document CER. |
| `https://www.codesota.com/api/sota/document-ocr?tier=sota` | `2021-11-03T00:00:00.000Z` | `reg-2021-11-03-1cbce0` | Pick is SCUT-CTW1500 FPS beside accuracy rows. |
| `https://www.codesota.com/api/sota/document-parsing?tier=sota` | `null` | `reg-2026-09-24-99c4ed` | `base`/pass-rate/accuracy are not interchangeable. |
| `https://www.codesota.com/api/sota/document-understanding?tier=sota` | `null` | `reg-2026-09-24-062b03` | DocVQA ANLS is question answering, not raw field transcription. |
| `https://www.codesota.com/api/sota/document-layout-analysis?tier=sota` | `2024-09-11T00:00:00.000Z` | `reg-2024-09-11-13e6eb` | Layout scores do not measure digit correctness. |
| `https://www.codesota.com/api/sota/table-recognition?tier=sota` | `2025-01-21T00:00:00.000Z` | `reg-2025-01-21-0551e2` | Table scores do not measure BSB/account/DOB exact match. |

## Candidate evidence

Scores below are kept attached to their benchmark and metric. They are not
ranked against one another.

| Candidate | Evidence in CodeSOTA | Evidence level | Hardware/privacy fit |
|---|---|---|---|
| PaddleOCR-VL-1.6 + PP-OCRv6 | No CodeSOTA row for the 1.6 release. The registry contains older Paddle rows: 79.1% olmOCR-Bench pass-rate, 92.9% OmniDocBench composite and 0.8% KITAB-Bench CER. | Older rows have 0 verified results; 1.6's 96.33% OmniDocBench figure is a vendor claim, not a registry reproduction. | Apache-2.0, local inference. Compact enough to test, but GB10/sm121 accuracy and the current PP-OCRv6 kernels are unverified. |
| LightOnOCR-2-1B | olmOCR-Bench pass-rate 83.2%, tables 89.0%, multi-column 84.8%. | Paper/vendor-level; model page reports 0/9 verified. | Apache-2.0, 1B BF16, vLLM/ARM64 paths exist; direct GB10 run unverified. |
| Qwen3-VL-4B-Instruct | ParseBench accuracy 62.0% (verified registry row); olmOCR-Bench pass-rate 79.2% is a paper result. | One verified row, but not an Australian digit benchmark. | Local model; vLLM support exists, but GB10 memory/kernels/launch flags are unmeasured. Check exact revision/licence before use. |
| olmOCR-2-7B-1025 | olmOCR-Bench accuracy 82.4%. | Model page reports 0/1 verified. | Apache-2.0 with Ai2 guidelines; BF16/FP8 on sm121 is unverified. Conditional later test only. |
| Qianfan-OCR | olmOCR-Bench pass-rate 79.8%, multi-column 92.2%, OmniDocBench composite 93.1%. | 0/16 verified. | Licence/weight metadata needs an exact-revision audit; no GB10 test. |
| HTR-JAND / DTrOCR | HTR-JAND: IAM CER 1.23%, WER 3.78%; DTrOCR: IAM CER 2.38%. | Verified registry rows, but IAM handwriting lines are not the target forms. | No confirmed GB10 production path or complete weight/licence evidence. |

## What the registry cannot tell us

There is no CodeSOTA evidence for:

- BSB, account-number or DOB exact match on Australian documents;
- Australian identity documents, bank statements, tax forms or mixed scans;
- Australian handwriting/cursive performance;
- direct GB10/`sm_121` execution, FP8/FP4 kernels, peak unified memory or
  sustained throughput;
- hallucinated/unsupported critical-field rate;
- human-review cost at an acceptable error budget;
- AU residency and zero retention for a cloud OCR provider.

No cloud candidate is recommended. The project contains Australian financial
and identity data; local inference remains the default.

## Required local bake-off

Freeze a person-held-out, human-labelled set and keep a sealed final split.
Include native PDFs, scans, identity documents, bank pages, forms, tables,
mixed handwriting and adversarial digit cases. Run the current baseline plus
the three candidates above and preserve raw output, boxes, model revision,
prompt, temperature, seed, render DPI, latency and failure details.

Report separately:

- BSB exact match;
- account-number exact match;
- DOB exact match and canonical-date exact match;
- digit-level CER, substitutions, deletions, insertions and confusion matrix;
- missing-field and unsupported/hallucinated-field rates;
- p50/p95 latency, pages per minute, peak memory/OOMs and failed-page rate;
- human review rate and correction time.

A VLM may propose a field, but automatic acceptance is allowed only when its
value is supported by native text/OCR and passes deterministic validation. If
the candidates disagree, send the value to review rather than overwriting a
critical digit.

## Codebase conclusion

There is no safe, evidence-backed one-line model replacement from CodeSOTA.
The useful improvements are architectural: preserve raw evidence, validate
critical numeric fields deterministically, keep a deterministic OCR reader as
the source of truth, and measure the candidates on the actual corpus. The
repository changes made alongside this review implement those guardrails and
add PHI-free runtime data diagnostics; they do not install unverified models
or change the privacy boundary.
