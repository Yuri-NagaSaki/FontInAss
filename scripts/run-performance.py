"""Run a benchmark container on a private SQLite snapshot; collect cgroup CPU/RSS.

python3 scripts/run-performance.py IMAGE SNAPSHOT_DB OUTPUT_DIR [ROUND]
The local font directory is mounted read-only. Production is never benchmarked.
"""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

image, snapshot, output = sys.argv[1:4]
round_id = sys.argv[4] if len(sys.argv) > 4 else "1"
output = Path(output).resolve()
output.mkdir(parents=True, exist_ok=True)
directory = Path(tempfile.mkdtemp(prefix="fontinass-perf-"))
shutil.copyfile(snapshot, directory / "fontinass-v2.db")
name = f"fontinass-perf-{os.getpid()}"
samples = []
stop = threading.Event()
def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()

try:
    docker("run", "-d", "--name", name, "--init", "--memory=3g", "--memory-swap=3g", "--pids-limit=128",
           "--cap-drop=ALL", "--security-opt=no-new-privileges", "-p", "127.0.0.1:3310:3000",
           "-v", f"{Path('fonts').resolve()}:/app/fonts:ro", "-v", f"{directory}:/app/data",
           "-e", "API_KEY=benchmark-only", "-e", "SUBSET_CONCURRENCY=2", "-e", "AUTO_INDEX_INTERVAL_HOURS=168", image)
    for attempt in range(100):
        try:
            with urllib.request.urlopen("http://127.0.0.1:3310/api/health", timeout=1) as response:
                if response.status == 200:
                    break
        except Exception:
            time.sleep(0.1)
    else:
        raise RuntimeError("Benchmark server failed to start")
    pid = int(docker("inspect", "-f", "{{.State.Pid}}", name))
    cgroup = Path("/sys/fs/cgroup") / Path(f"/proc/{pid}/cgroup").read_text().strip().split("::")[1].lstrip("/")
    def cpu():
        return int(dict(line.split() for line in (cgroup / "cpu.stat").read_text().splitlines())["usage_usec"])
    def sample():
        while not stop.wait(0.025):
            stats = dict(line.split() for line in (cgroup / "memory.stat").read_text().splitlines())
            samples.append({"anonymousBytes": int(stats["anon"]), "totalBytes": int((cgroup / "memory.current").read_text())})
    initial_cpu = cpu()
    monitor = threading.Thread(target=sample, daemon=True)
    monitor.start()
    started = time.monotonic()
    subprocess.run([os.environ.get("BENCHMARK_BUN", "bun"), "scripts/benchmark-performance.ts", "http://127.0.0.1:3310", str(output), round_id], check=True)
    metadata = {"image": image, "imageId": docker("inspect", "-f", "{{.Image}}", name),
                "snapshotSha256": hashlib.sha256(Path(snapshot).read_bytes()).hexdigest(),
                "bun": docker("exec", name, "bun", "--version"), "fontTools": docker("exec", name, "python3", "-c", "import fontTools; print(fontTools.__version__)"),
                "harfbuzz": docker("exec", name, "hb-subset", "--version"),
                "elapsedSeconds": time.monotonic() - started, "cpuSeconds": (cpu() - initial_cpu) / 1e6,
                "peakAnonymousBytes": max((s["anonymousBytes"] for s in samples), default=0),
                "peakCgroupBytes": max((s["totalBytes"] for s in samples), default=0), "sampleCount": len(samples)}
    (output / f"resources-{round_id}.json").write_text(json.dumps(metadata, indent=2))
    print(json.dumps(metadata))
finally:
    stop.set()
    subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, check=False)
    shutil.rmtree(directory)
