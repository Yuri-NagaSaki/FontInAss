export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413) {
    super(message);
  }
}

/** Finish network I/O before handing a body to Bun's multipart parser. */
export async function readRequestBody(request: Request, maximum: number, timeoutMs = 300_000): Promise<Request> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximum) {
    throw new RequestBodyError("Request exceeds the size limit", 413);
  }
  if (request.signal.aborted) throw new RequestBodyError("Request body was interrupted", 400);
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  let interrupt!: (error: RequestBodyError) => void;
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const onAbort = () => interrupt(new RequestBodyError("Request body was interrupted", 400));
  request.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => interrupt(new RequestBodyError("Request body timed out", 408)), timeoutMs);

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new RequestBodyError("Request exceeds the size limit", 413);
      chunks.push(value);
    }
    if (request.signal.aborted) throw new RequestBodyError("Request body was interrupted", 400);
    const headers = new Headers(request.headers);
    headers.delete("transfer-encoding");
    headers.set("content-length", String(size));
    return new Request(request, { headers, body: new Blob(chunks) });
  } catch (error) {
    // A disconnected native stream may never settle cancellation. Do not let it
    // retain an admission slot, and do not start the downstream handler.
    void reader.cancel(error).catch(() => undefined);
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("Request body was interrupted", 400);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
