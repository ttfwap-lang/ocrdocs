"""Hybrid printed + handwriting page reader.

Why this exists: the old pipeline ran up to 10 whole-page passes over Tesseract/PaddleOCR/EasyOCR and fed TrOCR
(a single-text-LINE model) the entire page, which can only produce nonsense. Measured on real data:
  printed pages   word-F1: Tesseract 0.89, EasyOCR 0.88          -> Tesseract wins, and is 2.4x faster
  handwriting     word-F1: TrOCR 0.93, Tesseract 0.21, EasyOCR 0.13
So: Tesseract reads the page and finds lines; lines it is unsure about, plus inked regions it found nothing in,
are cropped and sent to TrOCR one line at a time. Every line records which engine produced it and how confident
it was, so downstream code (and humans) can see exactly who read what.
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image

try:
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None

CONF_THRESHOLD = float(os.environ.get("OCRDOCS_HW_TESS_CONF_THRESHOLD", "0.72"))
TROCR_MIN_CONF = float(os.environ.get("OCRDOCS_HW_TROCR_MIN_CONF", "0.30"))
HANDWRITING_MODEL = os.environ.get("OCRDOCS_HANDWRITING_MODEL", "microsoft/trocr-large-handwritten")
TROCR_BATCH = int(os.environ.get("OCRDOCS_TROCR_BATCH", "8"))
MAX_TROCR_LINES = int(os.environ.get("OCRDOCS_TROCR_MAX_LINES", "80"))


@dataclass
class Line:
    x0: int
    y0: int
    x1: int
    y1: int
    text: str
    conf: float  # 0..1
    engine: str  # "Tesseract" | "TrOCR"
    tess_text: str = ""
    tess_conf: float = 0.0

    @property
    def box(self) -> Tuple[int, int, int, int]:
        return (self.x0, self.y0, self.x1, self.y1)


def _alnum(s: str) -> int:
    return sum(c.isalnum() for c in s)


def tesseract_lines(image: Image.Image, psm: int = 4) -> List[Line]:
    """Line boxes + real mean word confidence from Tesseract's word-level output."""
    data = pytesseract.image_to_data(image, lang="eng", config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
    groups = {}
    for i, word in enumerate(data.get("text", [])):
        word = (word or "").strip()
        if not word:
            continue
        c = data["conf"][i]
        conf = float(c) if str(c).lstrip("-").replace(".", "", 1).isdigit() else -1.0
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        g = groups.setdefault(key, {"words": [], "confs": [], "x0": x, "y0": y, "x1": x + w, "y1": y + h})
        g["words"].append(word)
        if conf >= 0:
            g["confs"].append(conf)
        g["x0"], g["y0"] = min(g["x0"], x), min(g["y0"], y)
        g["x1"], g["y1"] = max(g["x1"], x + w), max(g["y1"], y + h)
    lines = []
    for g in groups.values():
        text = " ".join(g["words"]).strip()
        if not text:
            continue
        conf = (sum(g["confs"]) / len(g["confs"]) / 100.0) if g["confs"] else 0.0
        lines.append(Line(g["x0"], g["y0"], g["x1"], g["y1"], text, conf, "Tesseract", text, conf))
    return lines


def uncovered_ink_lines(image: Image.Image, covered: Sequence[Line], min_w: int = 60) -> List[Tuple[int, int, int, int]]:
    """Boxes of inked regions no Tesseract line covers (typically handwriting Tesseract found nothing in)."""
    gray = np.array(image.convert("L"))
    h, w = gray.shape
    ink = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    for ln in covered:
        pad = 4
        ink[max(0, ln.y0 - pad): ln.y1 + pad, max(0, ln.x0 - pad): ln.x1 + pad] = 0
    # Merge strokes into text-line blobs: wide horizontal close, then drop specks.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(25, w // 40), 5))
    blobs = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, kernel)
    blobs = cv2.morphologyEx(blobs, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    n, _, stats, _ = cv2.connectedComponentsWithStats(blobs, connectivity=8)
    boxes = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if bw < min_w or bh < 14 or bh > h // 4:
            continue
        density = area / float(bw * bh)
        if density < 0.08:  # ruled lines / borders / dust
            continue
        boxes.append((x, y, x + bw, y + bh))
    return boxes


class TrOCRReader:
    """Lazy TrOCR line recognizer. recognize(crops) -> [(text, confidence 0..1)]."""

    def __init__(self, model_id: str = HANDWRITING_MODEL):
        self.model_id = model_id
        self._processor = None
        self._model = None
        self._device = "cpu"
        self.available: Optional[bool] = None

    def _load(self) -> bool:
        if self.available is not None:
            return self.available
        try:
            import torch
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel

            self._processor = TrOCRProcessor.from_pretrained(self.model_id)
            model = VisionEncoderDecoderModel.from_pretrained(self.model_id).eval()
            self._model, self._device = self.place_model(model, torch)
            self.available = True
            logging.info(f"[*] TrOCR line reader loaded: {self.model_id} on {self._device}")
        except Exception as e:  # noqa: BLE001 - degrade to Tesseract-only, never break the pipeline
            logging.warning(f"[!] TrOCR unavailable ({e}); handwriting lines will use Tesseract only.")
            self.available = False
        return self.available

    @staticmethod
    def place_model(model, torch_mod):
        """Put the model on the GPU if it fits; otherwise run on the CPU. A busy shared GPU must make the reader
        slower, never disable it (it once failed at CUDA-context creation and silently dropped handwriting)."""
        if torch_mod.cuda.is_available():
            try:
                return model.to("cuda"), "cuda"
            except Exception as e:  # noqa: BLE001 - OutOfMemoryError or a plain RuntimeError from context creation
                logging.warning(f"[!] TrOCR could not use the GPU ({str(e).splitlines()[0][:120]}); running on CPU.")
                try:
                    torch_mod.cuda.empty_cache()
                except Exception:  # noqa: BLE001
                    pass
        return model.to("cpu"), "cpu"

    def recognize(self, crops: Sequence[Image.Image]) -> List[Tuple[str, float]]:
        if not crops or not self._load():
            return [("", 0.0)] * len(crops)
        import torch

        out: List[Tuple[str, float]] = []
        step = TROCR_BATCH
        i = 0
        while i < len(crops):
            batch = [c.convert("RGB") for c in crops[i: i + step]]
            try:
                out.extend(self._run_batch(batch, torch))
                i += len(batch)
            except torch.cuda.OutOfMemoryError:
                # The GPU is shared with other services and can be nearly full. Shrink the batch first; if even one
                # line will not fit, move the model to the CPU (slow, but the page still gets read).
                torch.cuda.empty_cache()
                if step > 1:
                    step = max(1, step // 2)
                    logging.warning(f"[!] TrOCR GPU out of memory; retrying with batch size {step}.")
                elif self._device == "cuda":
                    logging.warning("[!] TrOCR GPU out of memory at batch 1; falling back to CPU for this worker.")
                    self._model = self._model.to("cpu")
                    self._device = "cpu"
                else:
                    raise
        return out

    def _run_batch(self, batch, torch) -> List[Tuple[str, float]]:
        with torch.inference_mode():
            pix = self._processor(images=batch, return_tensors="pt").pixel_values.to(self._device)
            gen = self._model.generate(
                pix, max_new_tokens=64, num_beams=4, num_return_sequences=1,
                return_dict_in_generate=True, output_scores=True,
            )
            texts = self._processor.batch_decode(gen.sequences, skip_special_tokens=True)
            scores = getattr(gen, "sequences_scores", None)
        res = []
        for j, t in enumerate(texts):
            conf = float(math.exp(float(scores[j]))) if scores is not None else 0.5
            res.append((t.strip(), max(0.0, min(1.0, conf))))
        return res


def _crop(image: Image.Image, box: Tuple[int, int, int, int], pad: int = 6) -> Image.Image:
    x0, y0, x1, y1 = box
    w, h = image.size
    return image.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))


def recognize_page(
    image: Image.Image,
    reader: Optional[TrOCRReader] = None,
    conf_threshold: float = CONF_THRESHOLD,
    tesseract_fn: Callable[[Image.Image], List[Line]] = tesseract_lines,
) -> List[Line]:
    """Read a page: Tesseract first, then TrOCR only where Tesseract is unsure or found nothing."""
    lines = tesseract_fn(image)
    if reader is None:
        return sorted(lines, key=lambda l: (l.y0, l.x0))

    weak = [l for l in lines if l.conf < conf_threshold or _alnum(l.text) < 2]
    ink_boxes = uncovered_ink_lines(image, lines)
    todo_boxes = [l.box for l in weak] + ink_boxes
    if len(todo_boxes) > MAX_TROCR_LINES:  # pathological page: keep the biggest candidates
        todo_boxes = sorted(todo_boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)[:MAX_TROCR_LINES]
    keep = {id(l) for l in lines}
    if todo_boxes:
        try:
            results = reader.recognize([_crop(image, b) for b in todo_boxes])
        except Exception as e:  # noqa: BLE001 - the Tesseract reading is still valid; never discard it
            logging.warning(f"[!] TrOCR failed ({e}); keeping Tesseract lines for this page.")
            return sorted(lines, key=lambda l: (l.y0 // 20, l.x0))
        by_box = {b: r for b, r in zip(todo_boxes, results)}
        for l in weak:
            text, c = by_box.get(l.box, ("", 0.0))
            # TrOCR replaces Tesseract only when it is both usable and more confident than what it replaces.
            if text and c >= TROCR_MIN_CONF and c > l.conf:
                l.text, l.conf, l.engine = text, c, "TrOCR"
        for b in ink_boxes:
            text, c = by_box.get(b, ("", 0.0))
            if text and c >= TROCR_MIN_CONF and _alnum(text) >= 2:
                lines.append(Line(b[0], b[1], b[2], b[3], text, c, "TrOCR"))
    return sorted((l for l in lines if l.text.strip()), key=lambda l: (l.y0 // 20, l.x0))


def lines_to_text(lines: Sequence[Line]) -> str:
    return "\n".join(l.text for l in lines)
