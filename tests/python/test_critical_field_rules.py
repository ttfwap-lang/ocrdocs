from scripts.critical_field_rules import classify_critical_field


def test_critical_field_rules_accept_common_australian_shapes():
    assert classify_critical_field("Bank State Branch (BSB)", "083-004")[0]
    assert classify_critical_field("Bank State Branch (BSB)", "083004")[0]
    assert classify_critical_field("Australian Bank Account Number", "492019482")[0]
    assert classify_critical_field("Australian Bank Account Number", "4920 19482")[0]
    for value in ["24/11/1963", "09/02/1991", "1988-06-14", "24 NOV 1963", "November 24, 1963", "14/06/88"]:
        assert classify_critical_field("Date of Birth (DOB)", value)[0], value


def test_critical_field_rules_reject_prose_masked_and_impossible_values():
    for value in ["", "unknown", "not a date", "99/99/9999", "02/31/1990", "14/06/1988; 14/06/1983"]:
        assert not classify_critical_field("Date of Birth (DOB)", value)[0], value
    for value in ["", "N/A", "12", "1234567"]:
        assert not classify_critical_field("Bank State Branch (BSB)", value)[0], value
    for value in ["", "xxxx", "12345", "12345678901"]:
        assert not classify_critical_field("Australian Bank Account Number", value)[0], value
