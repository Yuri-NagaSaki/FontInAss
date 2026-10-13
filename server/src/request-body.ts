interface RequestBodyDetails {
  reason: "size_limit" | "aborted" | "timeout" | "stream_error";
  receivedBytes: number;
  declaredBytes: number | null;
  limitBytes: number;
}

export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413, readonly details: RequestBodyDetails) {
    super(message);
  }
}

export function sizeLimitMessage(subject: string, size: number, maximum: number): string {
  const format = (bytes: number) => bytes < 1024 * 1024 ? `${bytes} bytes` : `${Number((bytes / 1024 / 1024).toFixed(2))} MiB (${bytes} bytes)`;
  return `${subject} exceeds the size limit (size ${format(size)}; limit ${format(maximum)})`;
}

/** Finish network I/O before handing a body to Bun's multipart parser. */
export async function readRequestBody(request: Request, maximum: number, timeoutMs = 300_000): Promise<Request> {
  const header = request.headers.get("content-length");
  const length = header === null ? null : Number(header);
  const declaredBytes = length !== null && Number.isSafeInteger(length) && length >= 0 ? length : null;
  let size = 0;
  const failure = (message: string, status: RequestBodyError["status"], reason: RequestBodyDetails["reason"]) =>
    new RequestBodyError(message, status, { reason, receivedBytes: size, declaredBytes, limitBytes: maximum });
  if (declaredBytes !== null && declaredBytes > maximum) {
    throw failure(sizeLimitMessage("Request", declaredBytes, maximum), 413, "size_limit");
  }
  if (request.signal.aborted) throw failure("Request body was interrupted", 400, "aborted");
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let interrupt!: (error: RequestBodyError) => void;
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const onAbort = () => interrupt(failure("Request body was interrupted", 400, "aborted"));
  request.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => interrupt(failure("Request body timed out", 408, "timeout")), timeoutMs);

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw failure(sizeLimitMessage("Request", size, maximum), 413, "size_limit");
      chunks.push(value);
    }
    if (request.signal.aborted) throw failure("Request body was interrupted", 400, "aborted");
    const headers = new Headers(request.headers);
    headers.delete("transfer-encoding");
    headers.set("content-length", String(size));
    return new Request(request, { headers, body: new Blob(chunks) });
  } catch (error) {
    // A disconnected native stream may never settle cancellation. Do not let it
    // retain an admission slot, and do not start the downstream handler.
    void reader.cancel(error).catch(() => undefined);
    if (error instanceof RequestBodyError) throw error;
    throw failure("Request body was interrupted", 400, request.signal.aborted ? "aborted" : "stream_error");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
