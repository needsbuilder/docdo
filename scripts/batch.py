#!/usr/bin/env python3
import os, subprocess, sys, glob, json
files = sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "fixtures/team/*.png"))
for f in files:
    name = os.path.basename(f)
    r = subprocess.run(["python3", "scripts/run_agent.py", f], capture_output=True, text=True, timeout=300)
    lines = [l for l in r.stdout.split("\n") if "final status" in l or "step model" in l]
    steps = [l.split("model=")[1].split(" status")[0] for l in lines if "step model" in l]
    t = next((l.split("total ")[1] for l in lines if "final status" in l), "?")
    print(f"{name:42s} {t:>7s}  steps: {' → '.join(steps)}")
    if r.returncode != 0: print("   ERR:", r.stdout[-200:], r.stderr[-200:])
