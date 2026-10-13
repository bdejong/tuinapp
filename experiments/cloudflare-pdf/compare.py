"""Compare native/Workers PDFs using page sizes, text and every rendered pixel.
Requires Poppler (pdftoppm), Pillow and pypdf; all files stay on this computer.
"""
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageChops
from pypdf import PdfReader

folder = Path(sys.argv[1]).resolve()

def compare(native):
    name = native.name.removesuffix('-native.pdf')
    worker = native.with_name(name + '-worker.pdf')
    left, right = PdfReader(native), PdfReader(worker)
    assert len(left.pages) == len(right.pages), (name, 'page count')
    for a, b in zip(left.pages, right.pages):
        assert a.mediabox == b.mediabox, (name, 'page geometry')
        assert a.extract_text() == b.extract_text(), (name, 'text')
    with TemporaryDirectory(prefix='tuinapp-pdf-compare-') as directory:
        temp = Path(directory)
        for label, path in [('native', native), ('worker', worker)]:
            subprocess.run(['pdftoppm', '-r', '150', '-png', str(path), str(temp / label)], check=True, capture_output=True)
        native_pages = sorted(temp.glob('native-*.png'))
        worker_pages = sorted(temp.glob('worker-*.png'))
        assert len(native_pages) == len(worker_pages) == len(left.pages)
        for a, b in zip(native_pages, worker_pages):
            with Image.open(a) as ai, Image.open(b) as bi:
                assert ai.size == bi.size
                assert ImageChops.difference(ai.convert('RGB'), bi.convert('RGB')).getbbox() is None, (name, a.name, 'pixels differ')
    return {'fixture': name, 'pages': len(left.pages), 'pixel_identical_at_dpi': 150, 'text_identical': True}

with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(compare, sorted(folder.glob('*-native.pdf'))))
assert len(results) >= 2
report = {'fixtures': len(results), 'pages': sum(r['pages'] for r in results), 'results': results}
(folder / 'comparison.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
