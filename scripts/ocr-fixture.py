"""Generate a synthetic "scanned" page (image-only PDF + PNG) for the OCR check.

The image has no text layer at all, exactly like a page from a scanned paper, so
it exercises the same path the reader takes: PNG -> Host -> tesseract. English
and Simplified Chinese are both on the page because the engine loads eng+chi_sim.

Usage (from the repository root):

    python scripts/ocr-fixture.py .build/ocr-fixture
    node scripts/ocr-check.mjs .build/ocr-fixture/scan.png .build/ocr-fixture/scan.pdf
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = {
    'latin': [
        r'C:\Windows\Fonts\arialbd.ttf',
        r'C:\Windows\Fonts\arial.ttf',
        r'C:\Windows\Fonts\DejaVuSans-Bold.ttf',
    ],
    'latin_body': [
        r'C:\Windows\Fonts\times.ttf',
        r'C:\Windows\Fonts\DejaVuSerif.ttf',
    ],
    'cjk': [
        r'C:\Windows\Fonts\msyh.ttc',
        r'C:\Windows\Fonts\simsun.ttc',
        r'C:\Windows\Fonts\NotoSansCJK-Regular.ttc',
    ],
}


def load_font(kind: str, size: int):
    for candidate in FONT_CANDIDATES[kind]:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    # Pillow >= 10.1 can size the built-in bitmap font; OCR of the fallback page
    # is still a valid smoke test, just less pretty.
    return ImageFont.load_default(size=size)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '.build/ocr-fixture')
    out.mkdir(parents=True, exist_ok=True)

    width, height = 1275, 1650  # US Letter at 150 DPI
    image = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(image)
    title = load_font('latin', 52)
    body = load_font('latin_body', 28)
    cjk = load_font('cjk', 30)

    y = 120
    draw.text((120, y), 'Attention Is All You Need', font=title, fill='black')
    y += 90
    lines = [
        'The dominant sequence transduction models are based on complex',
        'recurrent or convolutional neural networks that include an encoder',
        'and a decoder. The best performing models also connect the encoder',
        'and decoder through an attention mechanism.',
        '',
        'We propose a new simple network architecture, the Transformer,',
        'based solely on attention mechanisms, dispensing with recurrence',
        'and convolutions entirely.',
        '',
        '本文提出一种全新的简单网络结构 Transformer，完全基于注意力机制，',
        '不再使用循环和卷积。实验表明，该模型在机器翻译任务上效果更好，',
        '并且可以显著缩短训练时间。',
        '',
        'Key words: neural machine translation, attention, Transformer.',
    ]
    for line in lines:
        font = cjk if any(ord(char) > 127 for char in line) else body
        draw.text((120, y), line, font=font, fill='black')
        y += 44

    png_path = out / 'scan.png'
    pdf_path = out / 'scan.pdf'
    image.save(png_path)
    # An image-only PDF: PDF.js extracts no text from this page, which is what
    # makes the reader treat it as a scan and hand it to OCR.
    image.save(pdf_path, 'PDF', resolution=150)
    print(f'wrote {png_path} ({png_path.stat().st_size} bytes) and {pdf_path} ({pdf_path.stat().st_size} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
