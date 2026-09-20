"""Agent verifier: the loop, the tools, and above all the code-level refusal to accept unsupported corrections."""
import json

from PIL import Image

import ocr_agent_verify as av
import ocr_question_score as qs


def img():
    return Image.new("RGB", (1000, 1000), "white")


def call(name, **args):
    return {"content": "", "tool_calls": [{"id": "c1", "function": {"name": name, "arguments": json.dumps(args)}}]}


def final(*verdicts):
    return {"content": json.dumps({"verdicts": list(verdicts)}), "tool_calls": []}


class Script:
    """Feeds the verifier a fixed sequence of assistant messages and records what it was sent."""
    def __init__(self, *msgs):
        self.msgs, self.seen = list(msgs), []

    def __call__(self, messages, tools):
        self.seen.append(json.loads(json.dumps(messages, default=str)))
        return self.msgs.pop(0)


READERS = {"chandra": lambda im: "Account 12345678", "trocr": lambda im: "12345679", "paddle": lambda im: ""}
FLAG = [{"field": "account_number", "value": "12345670", "why": "DIGITS_NOT_READ"}]


def verifier(script, **kw):
    return av.AgentVerifier(script, kw.pop("readers", READERS), kw.pop("validators", {}), **kw)


def test_correction_supported_by_a_reader_is_accepted():
    s = Script(call("read_region", reader="chandra", box=[100, 100, 500, 200]),
               final({"field": "account_number", "verdict": "corrected", "value": "12345678", "box": [100, 100, 500, 200], "reasoning": "chandra read it"}))
    [v] = verifier(s).verify_page(1, img(), FLAG, ["page text"])
    assert (v.verdict, v.value, v.downgraded) == ("corrected", "12345678", False)


def test_correction_no_reader_produced_is_downgraded_to_unresolved():
    s = Script(call("read_region", reader="chandra", box=[0, 0, 500, 500]),
               final({"field": "account_number", "verdict": "corrected", "value": "99999999", "box": [0, 0, 500, 500], "reasoning": "looks like it"}))
    [v] = verifier(s).verify_page(1, img(), FLAG, [""])
    assert v.verdict == "unresolved" and v.downgraded and v.value == "12345670" and "not supported" in v.reasoning


def test_correction_without_a_cited_region_is_downgraded():
    s = Script(call("read_region", reader="chandra", box=[0, 0, 500, 500]),
               final({"field": "account_number", "verdict": "corrected", "value": "12345678", "reasoning": "trust me"}))
    [v] = verifier(s).verify_page(1, img(), FLAG, [""])
    assert v.verdict == "unresolved" and v.downgraded


def test_confirming_digits_nobody_read_is_downgraded_but_confirming_stored_text_is_fine():
    s = Script(final({"field": "account_number", "verdict": "confirmed", "value": "12345670", "reasoning": "fine"}))
    [v] = verifier(s).verify_page(1, img(), FLAG, ["nothing relevant"])
    assert v.verdict == "unresolved" and v.downgraded
    s = Script(final({"field": "account_number", "verdict": "confirmed", "value": "12345670", "reasoning": "in the text"}))
    [v] = verifier(s).verify_page(1, img(), FLAG, ["Account 1234 5670"])
    assert v.verdict == "confirmed"


def test_tools_return_reader_output_validator_result_and_other_page_text():
    s = Script(call("read_region", reader="trocr", box=[0, 0, 100, 100]),
               call("validate", field="bsb", value="062000"),
               call("page_text", page=2),
               final())
    v = verifier(s, validators={"bsb": lambda x: True})
    v.verify_page(1, img(), FLAG, ["p1", "second page"])
    tool_msgs = [m["content"] for m in s.seen[-1] if m["role"] == "tool"]
    assert tool_msgs == ["12345679", "valid", "second page"]


def test_bad_tool_input_is_reported_to_the_model_not_raised():
    s = Script(call("read_region", reader="trocr", box=[500, 500, 100, 100]),   # empty box
               call("read_region", reader="nope", box=[0, 0, 10, 10]),
               call("mystery"),
               final())
    verifier(s).verify_page(1, img(), FLAG, [""])
    msgs = [m["content"] for m in s.seen[-1] if m["role"] == "tool"]
    assert all(m.startswith("error") for m in msgs) and len(msgs) == 3


def test_malformed_or_missing_verdicts_become_unresolved_for_a_human():
    for reply in ({"content": "no json here", "tool_calls": []},
                  final({"field": "other_field", "verdict": "confirmed", "value": "x"}),
                  final({"field": "account_number", "verdict": "probably", "value": "x"})):
        [v] = verifier(Script(reply)).verify_page(1, img(), FLAG, [""])
        assert v.verdict == "unresolved"


def test_tool_call_budget_is_enforced_even_when_one_message_asks_for_many_calls():
    many = {"content": "", "tool_calls": [
        {"id": f"c{i}", "function": {"name": "page_text", "arguments": json.dumps({"page": 1})}} for i in range(av.MAX_TOOL_CALLS + 3)]}
    s = Script(many, final())
    verifier(s).verify_page(1, img(), FLAG, ["stored"])
    tool = [m["content"] for m in s.seen[-1] if m["role"] == "tool"]
    assert len(tool) == av.MAX_TOOL_CALLS + 3
    assert tool[:av.MAX_TOOL_CALLS] == ["stored"] * av.MAX_TOOL_CALLS
    assert all("budget exhausted" in t for t in tool[av.MAX_TOOL_CALLS:])


def test_step_budget_exhaustion_is_unresolved_never_silent_acceptance():
    s = Script(*[call("page_text", page=1) for _ in range(av.MAX_STEPS)])
    [v] = verifier(s).verify_page(1, img(), FLAG, ["x"])
    assert v.verdict == "unresolved" and "budget" in v.reasoning


def test_deadline_stops_the_loop():
    t = iter([0.0, av.DEADLINE_SECONDS + 1])
    [v] = verifier(Script(final()), clock=lambda: next(t)).verify_page(1, img(), FLAG, ["x"])
    assert v.verdict == "unresolved"


def test_unreachable_model_hands_every_field_to_a_human():
    def boom(m, t):
        raise OSError("down")

    [v] = av.AgentVerifier(boom, READERS).verify_page(1, img(), FLAG, ["x"])
    assert v.verdict == "unresolved" and "unavailable" in v.reasoning


def test_reasoning_and_the_page_image_reach_the_model_and_think_blocks_are_ignored():
    s = Script({"content": '<think>hmm</think>{"verdicts":[{"field":"account_number","verdict":"unresolved","value":"12345670","reasoning":"cannot tell"}]}', "tool_calls": []})
    [v] = verifier(s).verify_page(1, img(), FLAG, ["x"])
    assert v.verdict == "unresolved" and v.reasoning == "cannot tell"
    user = s.seen[0][1]["content"]
    assert user[0]["type"] == "image_url" and "DIGITS_NOT_READ" in user[1]["text"]


def test_verify_file_inspects_each_flagged_page_once_and_passes_file_level_flags_to_a_human():
    flags = [qs.Flag("DIGITS_NOT_READ", "'12345670' contains digits no OCR engine read", 1, "account_number"),
             qs.Flag("LOW_CONFIDENCE", "handwritten 'Lee' read at 0.40", 1, "family_name"),
             qs.Flag("DOC_TYPE_UNSURE", "document type is 'other'")]
    s = Script(final({"field": "account_number", "verdict": "unresolved", "value": "12345670", "reasoning": "a"},
                     {"field": "family_name", "verdict": "unresolved", "value": "Lee", "reasoning": "b"}))
    pages = [{"image": img(), "text": "one"}, {"image": img(), "text": "two"}]
    out = verifier(s).verify_file(pages, flags)
    assert len(s.seen) == 1                                  # one model call for both fields on page 2
    assert sorted((v.page, v.field) for v in out) == [(0, "DOC_TYPE_UNSURE"), (2, "account_number"), (2, "family_name")]
    assert next(v for v in out if v.field == "DOC_TYPE_UNSURE").verdict == "unresolved"


def test_qwen_chat_posts_tools_and_returns_the_assistant_message():
    seen = {}

    def post(url, body, timeout):
        seen.update(url=url, body=body)
        return {"choices": [{"message": {"content": "ok"}}]}

    msg = av.qwen_chat("http://x:8200/", "qwen-vl", post=post)([{"role": "user", "content": "hi"}], av.TOOLS)
    assert msg == {"content": "ok"} and seen["url"] == "http://x:8200/v1/chat/completions" and seen["body"]["tools"] == av.TOOLS
