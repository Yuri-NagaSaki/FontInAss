"""HarfBuzz preserves outlines/layout; FontTools updates names without rebuilding glyphs."""
import json
import os
import resource
import subprocess
import sys

# A worker is recycled after 64 jobs; these are lifetime resource ceilings.
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024 * 1024,) * 2)

from fontTools.ttLib import TTFont


def rename(font, family, ps_name, alias):
    names = font["name"]
    style = names.getDebugName(2) or "Regular"
    full = family if style.lower() == "regular" else f"{family} {style}"
    values = {1: family, 3: ps_name, 4: full, 6: ps_name, 16: family, 18: full, 21: family}
    # Alias mode must not retain original names that collide with another track.
    for record in list(names.names):
        if record.nameID in values and (alias or record.nameID in (3, 6)):
            try:
                record.string = values[record.nameID].encode(record.getEncoding(), errors="strict")
            except (UnicodeError, LookupError):
                names.names.remove(record)
    for name_id, value in values.items():
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 0, 4, 0)
    # CFF FontName and nameID 6 must agree for PostScript-based consumers.
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = [ps_name]
        cff.topDictIndex[0].FamilyName = family.encode("ascii", "replace").decode()
        cff.topDictIndex[0].FullName = ps_name


def subset(request):
    results = []
    for index, variant in enumerate(request["variants"]):
        try:
            face = variant["faceIndex"]
            output = os.path.join(request["directory"], f"{index}.sfnt")
            unicode_file = os.path.join(request["directory"], f"{index}.unicodes")
            with open(unicode_file, "w", encoding="ascii") as stream:
                stream.write(",".join(f"{cp:X}" for cp in variant["unicodes"]))
            subprocess.run([
                "hb-subset", request["font"], f"--face-index={face}",
                f"--unicodes-file={unicode_file}", f"--output-file={output}",
                "--layout-features=*", "--layout-scripts=*", "--name-IDs=*",
                "--name-languages=*", "--name-legacy", "--notdef-outline",
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20)
            with TTFont(output, lazy=True, recalcTimestamp=False) as font:
                # HarfBuzz's resulting cmap retains all requested mappings. Reading
                # the small subset avoids decompiling the full CJK source cmap.
                cmap = font.getBestCmap() or {}
                missing = [cp for cp in variant["unicodes"] if not cmap.get(cp) or cmap[cp] == ".notdef"]
                rename(font, variant["outputName"], variant["postScriptName"], variant["alias"])
                font.save(output + ".renamed", reorderTables=False)
                extension = "otf" if font.sfntVersion == "OTTO" else "ttf"
            os.replace(output + ".renamed", output)
            results.append({"path": output, "extension": extension, "missing": missing})
        except Exception as error:
            results.append({"error": f"{type(error).__name__}: {error}"[:500]})
    return results


if __name__ == "__main__":
    for line in sys.stdin:
        request = json.loads(line)
        result = subset(request)
        print(json.dumps(result), flush=True)
