"""Verify worker recycling across consecutive uncached font requests.

Usage: python3 scripts/soak-subset.py CONTAINER BASE_URL INPUT_ASS OUTPUT_JSON [COUNT]
Use an isolated container/database. Two concurrent requests; cgroup sampling 25 ms.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import base64,json,subprocess,threading,time,urllib.request,sys
container,base,subtitle,output=sys.argv[1:5]
if container == "fontinass-local": raise SystemExit("Use an isolated verification container")
count=int(sys.argv[5]) if len(sys.argv)>5 else 1000
nonce=time.time_ns()
body=Path(subtitle).read_bytes()
pid=int(subprocess.check_output(['docker','inspect','-f','{{.State.Pid}}',container],text=True))
cgroup=Path('/sys/fs/cgroup')/Path(f'/proc/{pid}/cgroup').read_text().strip().split('::')[1].lstrip('/')
stop=threading.Event();samples=[]
def monitor():
 while not stop.wait(.025):
  m=dict(line.split() for line in (cgroup/'memory.stat').read_text().splitlines());samples.append({'anon':int(m['anon']),'pids':int((cgroup/'pids.current').read_text())})
def task(i):
 request=urllib.request.Request(base.rstrip('/')+'/api/subset',data=body,headers={'Content-Type':'application/octet-stream','X-Font-Alias-Salt':base64.b64encode(f'soak-{nonce}-{i}'.encode()).decode()})
 start=time.monotonic()
 with urllib.request.urlopen(request,timeout=60) as response:
  output=response.read();assert response.status==200 and response.headers.get('x-code')=='200' and b'[Fonts]' in output
 return (time.monotonic()-start)*1000
threading.Thread(target=monitor,daemon=True).start();start=time.monotonic()
with ThreadPoolExecutor(max_workers=2) as pool:latencies=list(pool.map(task,range(count)))
stop.set();latencies.sort()
report={'requests':count,'concurrency':2,'errors':0,'elapsedSeconds':time.monotonic()-start,'medianMs':latencies[max(0,int(count*.5)-1)],'p95Ms':latencies[max(0,int(count*.95)-1)],'peakAnonymousBytes':max(s['anon'] for s in samples),'peakPids':max(s['pids'] for s in samples),'lastAnonymousBytes':samples[-1]['anon'],'sampleCount':len(samples)}
print(json.dumps(report,indent=2));Path(output).write_text(json.dumps(report,indent=2))
