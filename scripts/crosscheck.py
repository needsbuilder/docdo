#!/usr/bin/env python3
"""Python 원본 판정을 TS 대조용 같은 형식으로 출력한다."""
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("v", "scripts/verify.py")
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
d = sys.argv[1] if len(sys.argv) > 1 else "docs/evidence/photo"
for f in sorted(os.listdir(d)):
    if not f.endswith(".json"): continue
    r = v.verify(json.load(open(os.path.join(d, f))))
    name = f.replace("agent-raw-", "").replace(".json", "")
    print(f"{name}\t{r['verdict']}\t{r.get('checks_passed','-')}/{r.get('checks_total','-')}")
