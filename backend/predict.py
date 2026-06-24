"""
predict.py - CNN-based blur detection using the trained BlurCNN model.
Replaces the Laplacian variance method with a proper deep learning classifier.

Labels: 0 = Sharp, 1 = Blur
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

_model = None  # Lazy-loaded singleton
_transform = None

MODEL_PATH = Path(__file__).parent / "blur_model.pth"


def _load_model():
    """Load model once and cache it."""
    global _model, _transform
    if _model is not None:
        return _model, _transform

    import torch
    from torchvision import transforms
    from model import BlurCNN

    m = BlurCNN()
    m.load_state_dict(torch.load(str(MODEL_PATH), map_location="cpu"))
    m.eval()
    _model = m

    _transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
    ])

    return _model, _transform


def predict_blur(image_path: str) -> tuple[bool, float]:
    """
    Predict whether an image is blurry using the CNN model.

    Returns:
        (is_blurry: bool, confidence: float 0-1)
        is_blurry=True means the model classified it as Blur.
    """
    try:
        import torch
        from PIL import Image

        model, transform = _load_model()

        img = Image.open(image_path).convert("RGB")
        tensor = transform(img).unsqueeze(0)  # [1, 3, 224, 224]

        with torch.no_grad():
            output = model(tensor)             # [1, 2]
            probs = torch.softmax(output, dim=1)
            prediction = output.argmax(1).item()  # 0=Sharp, 1=Blur
            confidence = probs[0][prediction].item()

        return prediction == 1, round(confidence, 4)

    except Exception as e:
        # Fallback: if model fails, treat as not blurry
        return False, 0.0


def is_available() -> bool:
    """Check if PyTorch and the model file are available."""
    try:
        import torch
        from torchvision import transforms
        return MODEL_PATH.exists()
    except ImportError:
        return False
