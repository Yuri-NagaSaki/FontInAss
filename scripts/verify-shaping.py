"""Compare generated attachments with source fonts using HarfBuzz shaping and outlines.

Usage: python3 scripts/verify-shaping.py /tmp/fontinass-benchmark-preview
Requires the local font catalog, fontTools and hb-shape. Does not modify source fonts.
"""
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen


def uudecode(text):
    encoded = "".join(text.split())
    result = bytearray()
    for offset in range(0, len(encoded), 4):
        chunk = [ord(c) - 33 for c in encoded[offset:offset + 4]]
        if len(chunk) >= 2:
            result.append(((chunk[0] << 2) | (chunk[1] >> 4)) & 255)
        if len(chunk) >= 3:
            result.append(((chunk[1] << 4) | (chunk[2] >> 2)) & 255)
        if len(chunk) >= 4:
            result.append(((chunk[2] << 6) | chunk[3]) & 255)
    return bytes(result)


def shape(path, face, text, direction):
    return json.loads(subprocess.check_output([
        "hb-shape", str(path), text, f"--face-index={face}",
        "--no-glyph-names", "--output-format=json", f"--direction={direction}",
    ]))


def outline_signatures(font, shaped):
    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    result = []
    for item in shaped:
        pen = DecomposingRecordingPen(glyphs)
        glyphs[order[item["g"]]].draw(pen)
        result.append(hashlib.sha256(repr(pen.value).encode()).hexdigest())
    return result


directory = Path(sys.argv[1])
report = json.loads((directory / "results.json").read_text())
database = sqlite3.connect("file:data/fontinass-v2.db?mode=ro", uri=True)
results = []
for case in report["cases"]:
    name = case["font"].lstrip("@").lower()
    rows = database.execute("""SELECT ff.storage_key, f.face_index, f.weight, f.bold, f.italic, ff.size
        FROM font_names n JOIN font_faces f ON n.face_id=f.id JOIN font_files ff ON ff.id=f.file_id
        WHERE n.name_lower=?""", (name,)).fetchall()
    source_key, face, *_ = sorted(rows, key=lambda r: (r[3]*200+r[4]*100+abs(r[2]-400), -r[5], r[0]))[0]
    source_path = Path("fonts") / source_key
    ass = (directory / f'{case["name"]}.ass').read_text(encoding="utf-8-sig")
    encoded = ass.split("fontname:", 1)[1].split("\n", 1)[1].split("[Events]", 1)[0].strip()
    subset_path = directory / f'{case["name"]}.subset.font'
    subset_path.write_bytes(uudecode(encoded))
    source = TTFont(source_path, fontNumber=face)
    subset = TTFont(subset_path)
    direction = "ttb" if case["name"] == "vertical" else "rtl" if case["name"] == "arabic" else "ltr"
    before = shape(source_path, face, case["text"], direction)
    after = shape(subset_path, 0, case["text"], direction)
    positions = lambda shaped: [{k: v for k, v in item.items() if k != "g"} for item in shaped]
    row = {
        "case": case["name"], "sourceBytes": source_path.stat().st_size, "subsetBytes": subset_path.stat().st_size,
        "positionsEqual": positions(before) == positions(after),
        "outlinesEqual": outline_signatures(source, before) == outline_signatures(subset, after),
        "sourceTables": [tag for tag in ["GSUB", "GPOS", "GDEF", "vhea", "vmtx", "VORG", "glyf", "CFF "] if tag in source],
        "subsetTables": [tag for tag in ["GSUB", "GPOS", "GDEF", "vhea", "vmtx", "VORG", "glyf", "CFF "] if tag in subset],
    }
    results.append(row)
    source.close()
    subset.close()
print(json.dumps(results, indent=2, ensure_ascii=False))
(directory / "shaping.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
if not all(row["positionsEqual"] and row["outlinesEqual"] for row in results):
    sys.exit(1)
