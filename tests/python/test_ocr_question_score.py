"""S4 question score: every rule fires on the case it is for, and stays quiet on a clean file."""
import ocr_question_score as qs


def field(name, value, **o):
    return {"name": name, "value": value, "source": "print", "confidence": 0.9, "digits_verified": None,
            "subject": "applicant", "imageIndex": 0, **o}


def codes(flags):
    return sorted(f.code for f in flags)


CLEAN_PAGES = [{"imageIndex": 0, "kind": "both", "degraded": False}]


def test_clean_loan_application_has_no_flags():
    fields = [field("given_names", "John"), field("family_name", "Smith"), field("date_of_birth", "12/04/1985")]
    assert qs.question_flags(CLEAN_PAGES, fields, "loan_application") == []


def test_digits_no_engine_read_is_flagged_with_page_and_field():
    fl = qs.question_flags(CLEAN_PAGES, [field("bsb", "062-999", digits_verified=False, imageIndex=2)], "bank_statement")
    hit = next(f for f in fl if f.code == "DIGITS_NOT_READ")
    assert (hit.page, hit.field) == (2, "bsb")


def test_low_confidence_handwriting_is_flagged_but_low_confidence_print_is_not():
    fl = qs.question_flags(CLEAN_PAGES, [field("family_name", "Lee", source="handwriting", confidence=0.4)], "payslip")
    assert "LOW_CONFIDENCE" in codes(fl)
    fl = qs.question_flags(CLEAN_PAGES, [field("family_name", "Lee", source="print", confidence=0.4)], "payslip")
    assert "LOW_CONFIDENCE" not in codes(fl)


def test_failed_validator_is_flagged_and_unknown_result_is_not():
    v = {"abn": lambda s: s == "51824753556", "bsb": lambda s: None}
    fl = qs.question_flags(CLEAN_PAGES, [field("abn", "11111111111"), field("bsb", "062000")], "payslip", v)
    assert codes(fl).count("INVALID_VALUE") == 1


def test_unknown_owner_on_an_identity_field_is_flagged():
    fl = qs.question_flags(CLEAN_PAGES, [field("family_name", "Lee", subject="unknown")], "payslip")
    assert "OWNER_UNKNOWN" in codes(fl)


def test_two_different_applicant_values_are_ambiguous_but_parents_do_not_count():
    two = [field("given_names", "John"), field("given_names", "Jon", imageIndex=1)]
    assert "OWNER_AMBIGUOUS" in codes(qs.question_flags(CLEAN_PAGES, two, "payslip"))
    with_parent = [field("given_names", "John"), field("given_names", "Mary", subject="parent")]
    assert "OWNER_AMBIGUOUS" not in codes(qs.question_flags(CLEAN_PAGES, with_parent, "payslip"))


def test_degraded_and_uncertain_pages_are_flagged():
    pages = [{"imageIndex": 0, "kind": "printed", "degraded": True}, {"imageIndex": 1, "kind": "uncertain", "degraded": False}]
    assert set(codes(qs.question_flags(pages, [], "payslip"))) >= {"PAGE_DEGRADED", "PAGE_KIND_UNCERTAIN"}


def test_unsure_document_type_is_flagged():
    for t in ("other", "mixed"):
        assert "DOC_TYPE_UNSURE" in codes(qs.question_flags(CLEAN_PAGES, [], t))


def test_missing_expected_field_for_the_document_type_is_flagged():
    fl = qs.question_flags(CLEAN_PAGES, [field("family_name", "Smith")], "loan_application")
    missing = sorted(f.field for f in fl if f.code == "MISSING_EXPECTED")
    assert missing == ["date_of_birth", "given_names"]
    # a parent's given name does not satisfy the applicant's
    fl = qs.question_flags(CLEAN_PAGES, [field("given_names", "Mary", subject="parent")], "loan_application")
    assert "given_names" in [f.field for f in fl if f.code == "MISSING_EXPECTED"]


def test_readers_disagreeing_on_a_long_digit_run_is_flagged_and_agreement_is_not():
    a, b = "Account 1234 5678 9012", "Account 1234 5678 9013"
    assert "READERS_DISAGREE" in codes(qs.question_flags(CLEAN_PAGES, [], "payslip", reader_texts=[(0, a, b)]))
    assert "READERS_DISAGREE" not in codes(qs.question_flags(CLEAN_PAGES, [], "payslip", reader_texts=[(0, a, a)]))


def test_digit_tokens_ignore_short_numbers_and_join_spaced_digits():
    assert qs.digit_tokens("Page 3 of 12, BSB 062-000, acct 1234 5678") == {"062000", "12345678"}


def test_any_flag_sends_the_file_to_the_agent_and_none_does_not():
    assert qs.needs_agent([qs.Flag("X", "y")]) and not qs.needs_agent([])


def test_flag_rates_count_files_per_rule():
    a = [qs.Flag("DIGITS_NOT_READ", "", 0, "bsb"), qs.Flag("DIGITS_NOT_READ", "", 1, "abn")]
    b = [qs.Flag("PAGE_DEGRADED", "")]
    r = qs.flag_rates([a, b, []])
    assert r["files"] == 3 and r["flagged"] == 2 and r["flagged_pct"] == 66.7
    assert r["by_rule"] == {"DIGITS_NOT_READ": 1, "PAGE_DEGRADED": 1}


def test_a_field_the_two_sources_disagreed_on_is_flagged_with_both_values():
    fl = qs.question_flags(CLEAN_PAGES, [field("bsb", "062-000", alternateValue="062-999", alternateSource="qwen", imageIndex=1)], "bank_statement")
    hit = next(f for f in fl if f.code == "SOURCES_DISAGREE")
    assert (hit.page, hit.field) == (1, "bsb") and "'062-000' vs '062-999'" in hit.detail and "qwen" in hit.detail


def test_a_document_type_the_cloud_classifier_disputes_is_flagged():
    fl = qs.question_flags(CLEAN_PAGES, [], "payslip", document_type_alt="loan_application")
    assert "DOC_TYPE_DISAGREE" in codes(fl)
    assert "DOC_TYPE_DISAGREE" not in codes(qs.question_flags(CLEAN_PAGES, [], "payslip"))
