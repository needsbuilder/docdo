#!/usr/bin/env python3
"""Studio 에이전트 실행 + include:["all"] 원본 응답 덤프. 사용: python3 scripts/run_agent.py fixtures/01_nhis_control.png"""
import json, os, sys, time, urllib.request, mimetypes, uuid
ENV = dict(l.strip().split("=", 1) for l in open(os.path.join(os.path.dirname(__file__), "..", ".env")) if "=" in l and not l.startswith("#"))
KEY, AGENT = ENV["UPSTAGE_API_KEY"], ENV["UPSTAGE_AGENT_ID"]
H = {"Authorization": "Bearer " + KEY}
def upload(path):
    b = uuid.uuid4().hex; data = open(path, "rb").read(); ct = mimetypes.guess_type(path)[0] or "application/octet-stream"
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nuser_data\r\n--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(path)}\"\r\nContent-Type: {ct}\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
    r = urllib.request.Request("https://api.upstage.ai/v2/files", data=body, headers={**H, "Content-Type": f"multipart/form-data; boundary={b}"})
    return json.load(urllib.request.urlopen(r))["id"]
def jreq(method, url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, method=method, headers={**H, "Content-Type": "application/json"})
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: return {"HTTP_ERROR": e.code, "body": e.read().decode()[:800]}
path = sys.argv[1]; t0 = time.time()
fid = upload(path); print("file_id:", fid, f"({time.time()-t0:.1f}s)")
job = jreq("POST", "https://api.upstage.ai/v2/responses", {"model": AGENT, "include": ["all"], "input": [{"role": "user", "content": [{"type": "input_file", "file_id": fid}]}]})
if "HTTP_ERROR" in job: print(job); sys.exit(1)
jid = job["id"]; print("job_id:", jid, "status:", job["status"])
while job.get("status") in ("queued", "in_progress"):
    time.sleep(2); job = jreq("GET", f"https://api.upstage.ai/v2/responses/{jid}?include[]=all")
el = time.time() - t0
print(f"final status: {job.get('status')}  total {el:.1f}s")
out = os.path.join(os.path.dirname(__file__), "..", "docs", "evidence", "agent-raw-" + os.path.splitext(os.path.basename(path))[0] + ".json")
json.dump(job, open(out, "w"), ensure_ascii=False, indent=2); print("raw saved:", out)
for step in job.get("output", []):
    txt = step.get("content", [{}])[0].get("text", "")
    print(f"\n--- step model={step.get('model')} status={step.get('status')} ---"); print(txt[:700])
    av = step.get("content", [{}])[0].get("additional_values")
    if av: print("additional_values:", (av if isinstance(av, str) else json.dumps(av, ensure_ascii=False))[:500])
if job.get("error"): print("ERROR:", job["error"])
