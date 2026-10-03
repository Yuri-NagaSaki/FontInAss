"""Read-only comparison of legacy scanning and normalized indexed font lookup."""
import json
import sqlite3
import statistics
import sys
import time

database = sqlite3.connect(f"file:{sys.argv[1] if len(sys.argv) > 1 else 'data/fontinass-v2.db'}?mode=ro", uri=True)
reports = []
for label, expression in [
    ("legacy-scan", "lower(replace(replace(replace(n.name_lower, ' ', ''), '-', ''), '_', ''))"),
    ("normalized-index", "n.name_normalized"),
]:
    query = f"""SELECT {expression}, f.face_index, f.weight, f.bold, f.italic, ff.storage_key, ff.size
        FROM font_names n JOIN font_faces f ON f.id=n.face_id JOIN font_files ff ON ff.id=f.file_id
        WHERE {expression} IN (?)"""
    durations = []
    for _ in range(12):
        start = time.perf_counter()
        database.execute(query, ("notarealfont",)).fetchall()
        durations.append((time.perf_counter() - start) * 1000)
    reports.append({"query": label, "medianMs": round(statistics.median(durations), 3),
                    "plan": database.execute("EXPLAIN QUERY PLAN " + query, ("notarealfont",)).fetchall()})
print(json.dumps(reports, indent=2))
