"""Summarize A/B/C rounds, including runtime-only improvements and output equality."""
import json
from pathlib import Path
import statistics
import sys

root = Path(sys.argv[1])
groups = ["before", "runtime-only", "optimized"]
reports = {group: [json.loads(p.read_text()) for p in sorted((root / group).glob("round-*.json"))] for group in groups}
assert all(len(rows) >= 3 for rows in reports.values()), "Need at least 3 complete rounds per group"
rounds = [row["round"] for row in reports["before"]]
assert all([row["round"] for row in rows] == rounds for rows in reports.values()), "Round mismatch"
assert len({row["corpusSha256"] for rows in reports.values() for row in rows}) == 1, "Corpus mismatch"
assert len({row["clientBun"] for rows in reports.values() for row in rows}) == 1, "Load generator mismatch"

workloads = {}
for name in [result["name"] for result in reports["before"][0]["results"]]:
    values = {}
    for group in groups:
        samples = [next(result for result in row["results"] if result["name"] == name) for row in reports[group]]
        assert all(len(sample["observations"]) == len(samples[0]["observations"]) for sample in samples)
        values[group] = {"medianMs": statistics.median(sample["latencyMs"]["median"] for sample in samples),
                         "p95Ms": statistics.median(sample["latencyMs"]["p95"] for sample in samples),
                         "rps": statistics.median(sample["requestsPerSecond"] for sample in samples),
                         "requestCount": sum(len(sample["observations"]) for sample in samples),
                         "medianMsRange": [min(sample["latencyMs"]["median"] for sample in samples), max(sample["latencyMs"]["median"] for sample in samples)]}
    values["latencyReductionPercent"] = (1 - values["optimized"]["medianMs"] / values["before"]["medianMs"]) * 100
    values["runtimeOnlyLatencyReductionPercent"] = (1 - values["runtime-only"]["medianMs"] / values["before"]["medianMs"]) * 100
    values["throughputMultiplier"] = values["optimized"]["rps"] / values["before"]["rps"]
    workloads[name] = values

resources = {}
for group in groups:
    samples = [json.loads(path.read_text()) for path in sorted((root / group).glob("resources-*.json"))]
    resources[group] = {key: statistics.median(sample[key] for sample in samples) for key in ["cpuSeconds", "elapsedSeconds", "peakAnonymousBytes", "peakCgroupBytes"]}

identical = 0
for old, new in zip(reports["before"], reports["optimized"]):
    assert old["round"] == new["round"]
    for before, after in zip(old["results"][:3], new["results"][:3]):
        old_hashes = sorted(row["sha256"] for row in before["observations"])
        new_hashes = sorted(row["sha256"] for row in after["observations"])
        assert old_hashes == new_hashes, f"Output mismatch: {old['round']} {before['name']}"
        identical += len(old_hashes)

summary = {"method": f"Median of {len(rounds)} per-round medians/p95/throughput values; warm filesystem, uncached results use unique salts", "workloads": workloads,
           "resources": resources, "byteIdenticalSubtitleResponses": identical,
           "totalRequests": sum(value[group]["requestCount"] for value in workloads.values() for group in groups)}
(root / "summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
