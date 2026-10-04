import { kill } from "node:process";
import type { FileSink, Subprocess } from "bun";

interface Worker {
  process: Subprocess<"pipe", "pipe", "pipe">;
  pending: { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null;
  jobs: number;
  stderr: string;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/** A bounded JSON-lines pool. A failed or timed-out process is never reused. */
export class NativeWorkerPool {
  private readonly workers = new Set<Worker>();
  private readonly queue: Array<{ request: unknown; resolve(value: unknown): void; reject(error: Error): void }> = [];
  private closed = false;

  constructor(private readonly command: string[], private readonly options: {
    concurrency: number; timeoutMs?: number; maxJobs?: number; idleMs?: number;
  }) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) throw new Error("Worker concurrency must be positive");
  }

  run(request: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Font workers are closed"));
    if (this.queue.length >= 32) return Promise.reject(new Error("Font worker queue is full"));
    return new Promise((resolve, reject) => { this.queue.push({ request, resolve, reject }); this.dispatch(); });
  }

  close(): void {
    this.closed = true;
    for (const task of this.queue.splice(0)) task.reject(new Error("Font workers are closed"));
    for (const worker of this.workers) this.retire(worker, new Error("Font workers are closed"));
  }

  private dispatch(): void {
    while (!this.closed && this.queue.length) {
      let worker = [...this.workers].find(item => !item.pending);
      if (!worker && this.workers.size >= this.options.concurrency) return;
      const task = this.queue.shift()!;
      try { worker ??= this.spawn(); }
      catch (error) { task.reject(error instanceof Error ? error : new Error(String(error))); continue; }
      clearTimeout(worker.idleTimer);
      const selected = worker;
      const timer = setTimeout(() => this.retire(selected, new Error("Font worker timed out")), this.options.timeoutMs ?? 60_000);
      worker.pending = { ...task, timer };
      worker.jobs++;
      try {
        const stdin = worker.process.stdin as FileSink;
        stdin.write(JSON.stringify(task.request) + "\n");
        void Promise.resolve(stdin.flush()).catch(error => this.retire(selected, error));
      } catch (error) { this.retire(worker, error instanceof Error ? error : new Error(String(error))); }
    }
  }

  private spawn(): Worker {
    const process = Bun.spawn(this.command, { stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: true });
    const worker: Worker = { process, pending: null, jobs: 0, stderr: "" };
    this.workers.add(worker);
    void this.read(worker);
    void (async () => {
      const reader = process.stderr.getReader();
      try { while (true) { const { done, value } = await reader.read(); if (done) break; worker.stderr = (worker.stderr + new TextDecoder().decode(value)).slice(-2048); } }
      catch { /* stdout/exit path reports the failure */ }
      finally { reader.releaseLock(); }
    })();
    void process.exited.then(code => this.retire(worker, new Error(`Font worker exited ${code}: ${worker.stderr}`)));
    return worker;
  }

  private async read(worker: Worker): Promise<void> {
    const reader = worker.process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { this.retire(worker, new Error(`Font worker closed output: ${worker.stderr}`)); return; }
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 4 * 1024 * 1024) throw new Error("Font worker response is too large");
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const result = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          const task = worker.pending;
          if (!task) throw new Error("Unexpected font worker response");
          clearTimeout(task.timer);
          worker.pending = null;
          task.resolve(result);
          if (worker.jobs >= (this.options.maxJobs ?? 64)) this.retire(worker);
          else {
            worker.idleTimer = setTimeout(() => this.retire(worker), this.options.idleMs ?? 30_000);
            worker.idleTimer.unref();
          }
          this.dispatch();
        }
      }
    } catch (error) { this.retire(worker, error instanceof Error ? error : new Error(String(error))); }
    finally { reader.releaseLock(); }
  }

  private retire(worker: Worker, error = new Error("Font worker retired")): void {
    if (!this.workers.delete(worker)) return;
    clearTimeout(worker.idleTimer);
    if (worker.pending) {
      clearTimeout(worker.pending.timer);
      worker.pending.reject(error);
      worker.pending = null;
    }
    // The detached session owns HarfBuzz children too; timeout/close kills the tree.
    try { kill(-worker.process.pid, "SIGKILL"); } catch { worker.process.kill("SIGKILL"); }
    this.dispatch();
  }
}
