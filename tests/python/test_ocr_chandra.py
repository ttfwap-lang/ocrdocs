"""Chandra client: HTML block parsing (using real output shape from the GB10 bake-off) and outage handling."""
import pytest
from PIL import Image

import ocr_chandra as ch

# Shape copied from a real bake-off page: an image block carrying a generated description, then text blocks.
REAL = (
    '<div data-bbox="171 80 426 172" data-label="Image"><img alt="MEX Accounting logo"/>The logo for MEX Accounting. '
    'It features the word "mex" in a large, bold, purple font.</div>'
    '<div data-bbox="737 80 960 143" data-label="Text"><p>MEX Accounting<br/>Unit 1 5-7 Compark circuit<br/>'
    'Mulgrave VIC 3170<br/>+61 3 85446666</p></div>'
    '<div data-bbox="169 180 291 196" data-label="Text"><p>14 September 2026</p></div>'
)


def img():
    return Image.new("RGB", (100, 100), "white")


def test_blocks_are_parsed_with_label_and_bbox():
    page = ch.parse_html(REAL)
    assert [b.label for b in page.blocks] == ["Image", "Text", "Text"]
    assert page.blocks[1].bbox == [737, 80, 960, 143]


def test_image_descriptions_never_enter_the_text():
    page = ch.parse_html(REAL)
    assert "logo" not in page.text and "purple" not in page.text
    assert page.text.splitlines()[:4] == ["MEX Accounting", "Unit 1 5-7 Compark circuit", "Mulgrave VIC 3170", "+61 3 85446666"]
    assert "14 September 2026" in page.text


def test_table_rows_become_lines_and_cells_tabs():
    html = '<div data-label="Table" data-bbox="0 0 10 10"><table><tr><td>BSB</td><td>062-000</td></tr><tr><td>Acct</td><td>12345678</td></tr></table></div>'
    assert ch.parse_html(html).text == "BSB\t062-000\nAcct\t12345678"


def test_output_without_div_blocks_is_kept_as_plain_text():
    page = ch.parse_html("<p>Just <b>text</b></p>")
    assert page.text == "Just text" and page.blocks[0].label == "Text"


def test_empty_output_gives_empty_page():
    page = ch.parse_html("")
    assert page.text == "" and page.blocks == []


def test_read_page_sends_the_html_prompt_and_parses_the_reply():
    seen = {}

    def post(url, body, timeout):
        seen.update(url=url, body=body)
        return {"choices": [{"message": {"content": REAL}}]}

    page = ch.read_page(img(), post=post, base_url="http://x:9/")
    assert seen["url"] == "http://x:9/v1/chat/completions"
    assert seen["body"]["messages"][0]["content"][1]["text"] == "OCR this image to HTML."
    assert "Mulgrave VIC 3170" in page.text


def test_read_page_retries_then_raises_unavailable(monkeypatch):
    monkeypatch.setattr(ch.time, "sleep", lambda s: None)
    calls = []

    def post(url, body, timeout):
        calls.append(1)
        raise OSError("refused")

    with pytest.raises(ch.ChandraUnavailable):
        ch.read_page(img(), post=post)
    assert len(calls) == ch.CHANDRA_RETRIES + 1
