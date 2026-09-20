"""DenseNet-121 page triage: the first pass over every rendered page.

Classes (photo and non-document images are folded into "blank": there is no document text to read):
  printed | handwritten | both | blank
Asymmetric by design: a missed handwritten page loses data, an extra reader run only costs time, so anything the model
is unsure of is "uncertain" (the caller asks Qwen, or runs everything), and "blank" needs both a high probability and
a low ink ratio before a page is skipped.

Weights: OCRDOCS_TRIAGE_WEIGHTS (a state dict saved by scripts/triage_train.py). With no weights, load_if_configured()
returns None and the pipeline behaves exactly as it did before this module existed.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import List, Optional, Sequence, Tuple

import numpy as np
import torch
from PIL import Image
from torchvision.models import densenet121

CLASSES = ["printed", "handwritten", "both", "blank"]
INPUT_SIZE = int(os.environ.get("OCRDOCS_TRIAGE_INPUT_SIZE", "512"))
MIN_PROB = float(os.environ.get("OCRDOCS_TRIAGE_MIN_PROB", "0.80"))
BLANK_MIN_PROB = float(os.environ.get("OCRDOCS_TRIAGE_BLANK_MIN_PROB", "0.95"))
BLANK_MAX_INK = float(os.environ.get("OCRDOCS_TRIAGE_BLANK_MAX_INK", "0.004"))
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)


def build_model(num_classes: int = len(CLASSES)) -> torch.nn.Module:
    m = densenet121(weights=None)
    m.classifier = torch.nn.Linear(m.classifier.in_features, num_classes)
    return m


def preprocess(image: Image.Image, size: int = INPUT_SIZE) -> np.ndarray:
    """Grayscale, letterboxed onto white so the aspect ratio (and stroke thickness) is preserved -> 3xSxS float."""
    g = image.convert("L")
    w, h = g.size
    scale = size / max(w, h)
    g = g.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.BILINEAR)
    canvas = Image.new("L", (size, size), 255)
    canvas.paste(g, ((size - g.width) // 2, (size - g.height) // 2))
    a = np.asarray(canvas, dtype=np.float32) / 255.0
    return (np.stack([a, a, a]) - _MEAN) / _STD


def ink_ratio(image: Image.Image) -> float:
    """Fraction of dark pixels on a small copy: about a millisecond, and independent of the network."""
    g = np.asarray(image.convert("L").resize((256, 256), Image.Resampling.BILINEAR))
    return float((g < 128).mean())


def route(kind: str, prob: float, ink: float, min_prob: float = MIN_PROB, blank_min_prob: float = BLANK_MIN_PROB,
          blank_max_ink: float = BLANK_MAX_INK) -> str:
    """Decide what the pipeline does with a page. Returns one of CLASSES or "uncertain"."""
    if prob < min_prob:
        return "uncertain"
    if kind == "blank":
        if prob >= blank_min_prob and ink <= blank_max_ink:
            return "blank"
        return "uncertain" if ink > blank_max_ink * 5 else "printed"  # inky "blank" = photo or missed content
    return kind


class TriageModel:
    def __init__(self, model: torch.nn.Module, device: str):
        self.device = device
        self.model = model.to(device).eval()
        self._lock = threading.Lock()

    @classmethod
    def load(cls, path: str, device: Optional[str] = None) -> "TriageModel":
        device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        state = torch.load(path, map_location="cpu", weights_only=True)
        state = state.get("model", state) if isinstance(state, dict) else state
        model = build_model()
        model.load_state_dict(state)
        return cls(model, device)

    def predict_batch(self, images: Sequence[Image.Image], batch_size: int = 32) -> List[Tuple[str, float]]:
        out: List[Tuple[str, float]] = []
        for i in range(0, len(images), batch_size):
            x = torch.from_numpy(np.stack([preprocess(im) for im in images[i:i + batch_size]]))
            with self._lock, torch.inference_mode():
                try:
                    probs = torch.softmax(self.model(x.to(self.device)), dim=1).cpu().numpy()
                except torch.cuda.OutOfMemoryError:  # the GPU is shared; degrade to CPU rather than fail the page
                    logging.warning("[!] Triage GPU OOM; moving the model to CPU.")
                    self.model.to("cpu")
                    self.device = "cpu"
                    probs = torch.softmax(self.model(x), dim=1).numpy()
            out.extend((CLASSES[int(p.argmax())], float(p.max())) for p in probs)
        return out


def load_if_configured() -> Optional[TriageModel]:
    path = os.environ.get("OCRDOCS_TRIAGE_WEIGHTS", "").strip()
    if not path:
        return None
    if not os.path.exists(path):
        logging.warning(f"[!] OCRDOCS_TRIAGE_WEIGHTS={path} does not exist; page triage is disabled.")
        return None
    try:
        return TriageModel.load(path)
    except Exception as e:  # noqa: BLE001 - a bad weights file must not take the worker down
        logging.warning(f"[!] Could not load triage weights ({e}); page triage is disabled.")
        return None
