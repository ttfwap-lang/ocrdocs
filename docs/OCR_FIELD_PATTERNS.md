# OCR Field Patterns — Per-Field Review

`BANK_FIELD_PATTERNS` in `scripts/ocr_spark_engine.py` is the label→field map used by the
contextual line-scan in `extract_australian_banking_fields`. Each entry is a `re.compile`
(`re.I`) scanned per line; when a label matches, the value after the first `: / - / = / tab`
is captured. A value is only accepted when `not data[field] or confidences[field] < line_conf`,
so a higher-confidence label-scoped match always displaces a loose standalone guess.

The set was reviewed field-by-field for logical correctness, false-positive surface, and
coverage. It shipped **30 reviewed + 30 added = 60 fields**.

## Refinements applied to the original 30

| Field | False-positive / coverage risk identified | Fix applied |
|-------|-------------------------------------------|-------------|
| `date_of_birth` | Label `date[_-]?of[_-]?birth` used `[_-]?` which does **not** match a space, so "Date of Birth: 15/06/1985" never matched the label — the loose standalone DOB regex (first valid date in text, incl. statement/transaction dates) silently won instead. | Label separator is now `[\s_-]?` so spaced forms match; standalone DOB confidence lowered to `0.85` so the labeled, colon-scoped line (0.95 native / real OCR conf) overrides. The native-text test (`conf==0.95` on "Date of Birth: 15/06/1985") now passes *because* the label matches. |
| `bsb` (label) | Label `\b(bsb|bank_state_branch|branch_code)\b` is fine; it is colon-gated. | unchanged. |
| `bsb` (standalone value) | Value regex `\b\d{3}[- ]?\d{3}\b` matched **any** 6-digit run (any invoice/page/account ref), and `validate_australian_bsb` only checks 6 digits + prefix 1–99 → very high false-positive rate. | Value regex tightened to `\b\d{3}[- ]\d{3}\b` (requires a `-` or space between triads, like real "062-000"); standalone confidence lowered to `0.60` so a labeled `BSB:` line (native 0.95 / OCR conf) always wins. "062-000" still matches. |
| `abn` | Standalone is Mod-89 validated (strong gate). | confidence left high (`1.0`); authoritative. |
| `title_salutation` | `mr|mrs|ms|miss|dr|prof|rev` match common words anywhere ("ms delay", "dr." in prose). | Mitigation: line-scan only fires when the label is followed by a `: / - / = / tab` delimiter (colon-gating), so a bare "ms" with no value does not fill. Kept; documented risk. |
| `mobile_number` / `email_address` | `phone|tel` / label tokens can hit prose, but values are structurally validated (AU phone format / email regex). | labels colon-gated; value format filters FPs. Kept. |
| `employment_status` / `renting|mortgaged|owned` | Bare `single|married` etc. can appear in free text. | colon-gated; kept, low residual risk. |
| `dependants_count` / `children|kids` | Context FP in prose. | colon-gated; kept. |
| `occupation_industry` / `trade|profession|occupation` | `profession` overlaps `title_salutation`'s `prof`. | both colon-gated; first match in insertion order fills, merge gate prevents churn. kept. |
| `salary_frequency` / `weekly|monthly|annual` | Bare frequency words. | colon-gated; kept. |

> Principle: the **label** regex merely decides which line *belongs* to a field; the
> **value** is taken via colon/dash/equals/tab split, so free-text matches without a
> value delimiter yield nothing. The standalone value extractors (ABN/BSB/DOB/phone/
> email/postcode/currency) are the only un-gated paths and are now either structurally
> validated (ABN Mod-89, phone/email format, postcode band) or confidence-gated below
> the labeled path (BSB 0.60, DOB 0.85).

## Original 30 fields (reviewed)

`title_salutation, given_names, middle_name, family_name, date_of_birth,
residency_status, marital_status, dependants_count, residential_address,
address_tenure, previous_address, housing_situation, mobile_number,
email_address, drivers_licence, passport_details, employment_status,
occupation_industry, employer_details, employment_tenure, gross_annual_income,
net_monthly_income, salary_frequency, other_income, living_expenses,
credit_card_limits, other_liabilities, bsb, account_number, abn`

## New 30 fields (added to double coverage)

AU bank / loan-application form fields that were missing. All are label-gated
(capture the value after `:` / `-`).

| Field | Matches | Notes |
|-------|---------|-------|
| `tax_file_number` | `tax file number / tax id / tf number / tfn / tax file no` | TFN is 9-11 digits; validated downstream if present. |
| `drivers_licence_number` | `driver's licence number / licence no / dl number` | Distinct from `drivers_licence` (which also matches the card label). |
| `drivers_licence_state` | `licence state / licence jurisdiction / issuing state` | AU: NSW/VIC/QLD/… |
| `drivers_licence_expiry` | `licence expiry / licence exp / dl expiry` | Date value. |
| `passport_expiry` | `passport expiry / passport exp` | Date value. |
| `passport_issuing_country` | `passport issue country / issuing country` | |
| `postal_address` | `postal/mailing/mail/post address` | Distinct from residential. |
| `country_of_birth` | `country of birth / birth country / birthplace` | |
| `gender` | `gender / sex at birth / gender at birth` | Colon-gated. |
| `loan_amount_requested` | `loan amount / amount borrowed / finance amount` | |
| `loan_type` | `loan type / type of loan / loan product / credit type` | |
| `loan_term_years` | `loan term / loan duration / amortisation period` | |
| `loan_purpose` | `loan purpose / intended use / use of funds / financing purpose` | |
| `existing_loan_amount` | `existing/current loan / outstanding loan / balance outstanding` | |
| `monthly_loan_repayment` | `monthly repayment / monthly loan payment / installment amount` | |
| `total_monthly_debt` | `total monthly debt / total debt / aggregate debt` | |
| `savings_balance` | `savings balance / deposit balance / bank savings` | |
| `investment_balance` | `investment balance / investment value / portfolio value` | |
| `property_value` | `property value / real estate value / market value / valuation amount` | |
| `superannuation_balance` | `superannuation / super balance / super fund balance` | |
| `existing_credit_cards` | `existing credit card / number of credit cards / credit card count` | |
| `total_credit_limits` | `total credit limit / aggregate credit / combined credit limit` | |
| `total_existing_debt` | `total existing debt / overall debt / total liabilities` | |
| `life_insurance_cover` | `life insurance / life cover / critical illness cover / death benefit` | |
| `monthly_rent` | `monthly rent / rent paid / rent amount / weekly rent` | |
| `monthly_other_expenses` | `other monthly expenses / discretionary spending / other commitments` | |
| `employment_industry_code` | `industry code / an code / anzsic code / occupation code` | Dist from `occupation_industry`. |
| `years_employment_current` | `years with employer / current employer tenure / length of current employment` | |
| `previous_employer` | `previous employer / prior employer / last employer` | |
| `applicants_count` | `number of applicants / co-applicants / joint applicants / applicants count` | Uses `number of`/`count` form (not bare "applicants") to avoid free-text FPs. |

## Coverage note

The original 30 captured the *core identity + financial* form fields. The 30 additions
complete the common **loan application** envelope (identity-document metadata, loan
structure, assets/liabilities, insurance, employment detail). With 60 keys the pipeline's
`recall_percent = fields_filled / 60` is now measured against a realistic form surface.
