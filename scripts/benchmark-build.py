"""Build/check timing; use archived baseline + isolated dependencies for A/B.

python3 scripts/benchmark-build.py REPO BUN OUTPUT_JSON
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

repository, output = (Path(value).resolve() for value in [sys.argv[1], sys.argv[3]])
# Preserve bin-directory symlinks so nested `bun run` commands use the same version.
executable = Path(sys.argv[2]).absolute()
environment = {**os.environ, "PATH": str(executable.parent) + os.pathsep + os.environ["PATH"]}
result = {"bun": subprocess.check_output([str(executable), "--version"], text=True).strip(), "samples": {}}
for script in ["typecheck", "build"]:
    values = []
    for iteration in range(4):
        started = time.monotonic()
        run = subprocess.run([str(executable), "run", script], cwd=repository, env=environment, capture_output=True, text=True)
        elapsed = time.monotonic() - started
        if run.returncode:
            raise RuntimeError(run.stdout + run.stderr)
        if iteration:  # first pass warms filesystem/tool caches
            values.append(elapsed)
    result["samples"][script] = values
    print(script, values, flush=True)
result["serverBundleBytes"] = (repository / "server/dist/index.js").stat().st_size
result["webJavaScriptBytes"] = sum(file.stat().st_size for file in (repository / "web/dist/assets").glob("*.js"))
output.write_text(json.dumps(result, indent=2))
