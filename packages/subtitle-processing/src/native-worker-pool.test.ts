import { describe, expect, test } from "bun:test";
import { NativeWorkerPool } from "./native-worker-pool.js";

const command = ["python3", "-u", "-c", `import json,os,sys,time
for line in sys.stdin:
    data=json.loads(line)
    if data.get('crash'): os._exit(7)
    if data.get('sleep'): time.sleep(data['sleep'])
    print(json.dumps({'pid':os.getpid(),'value':data.get('value')}),flush=True)
`];

describe("native font worker lifecycle", () => {
  test("reuses a worker and serializes concurrent requests without mixing responses", async () => {
    const pool = new NativeWorkerPool(command, { concurrency: 1 });
    try {
      const results = await Promise.all(Array.from({ length: 6 }, (_, value) => pool.run({ value }))) as Array<{ pid: number; value: number }>;
      expect(results.map(row => row.value)).toEqual([0,1,2,3,4,5]);
      expect(new Set(results.map(row => row.pid)).size).toBe(1);
    } finally { pool.close(); }
  });
  test("recycles processes after their job budget", async () => {
    const pool = new NativeWorkerPool(command, { concurrency: 1, maxJobs: 1 });
    try {
      const first = await pool.run({}) as { pid: number };
      const second = await pool.run({}) as { pid: number };
      expect(first.pid).not.toBe(second.pid);
    } finally { pool.close(); }
  });
  test("replaces crashed and timed-out workers and continues queued work", async () => {
    const pool = new NativeWorkerPool(command, { concurrency: 1, timeoutMs: 150 });
    try {
      await expect(pool.run({ crash: true })).rejects.toThrow(/closed|exited/);
      await expect(pool.run({ sleep: 5 })).rejects.toThrow("timed out");
      expect(await pool.run({ value: "recovered" })).toMatchObject({ value: "recovered" });
    } finally { pool.close(); }
  });
  test("closing rejects active and queued work", async () => {
    const pool = new NativeWorkerPool(command, { concurrency: 1 });
    const active = pool.run({ sleep: 5 }).catch(error => error as Error);
    const queued = pool.run({ value: 1 }).catch(error => error as Error);
    pool.close();
    expect((await active as Error).message).toContain("closed");
    expect((await queued as Error).message).toContain("closed");
    await expect(pool.run({})).rejects.toThrow("closed");
  });
});
