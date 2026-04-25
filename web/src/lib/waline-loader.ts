export const WALINE_SERVER = import.meta.env.VITE_WALINE_SERVER ?? "https://waline.anibt.net/";

type WalineModule = typeof import("@waline/client");

let walineModulePromise: Promise<WalineModule> | null = null;
let preconnected = false;

function walineOrigin(): string | null {
  try {
    return new URL(WALINE_SERVER).origin;
  } catch {
    return null;
  }
}

export function preconnectWaline(): void {
  if (preconnected || typeof document === "undefined") return;
  const origin = walineOrigin();
  if (!origin) return;

  const preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = origin;
  preconnect.crossOrigin = "anonymous";
  document.head.appendChild(preconnect);

  const dnsPrefetch = document.createElement("link");
  dnsPrefetch.rel = "dns-prefetch";
  dnsPrefetch.href = origin;
  document.head.appendChild(dnsPrefetch);

  preconnected = true;
}

export function preloadWalineAssets(): Promise<WalineModule> {
  preconnectWaline();
  if (!walineModulePromise) {
    walineModulePromise = Promise.all([
      import("@waline/client"),
      import("@waline/client/waline.css"),
    ])
      .then(([walineModule]) => walineModule)
      .catch((error) => {
        walineModulePromise = null;
        throw error;
      });
  }
  return walineModulePromise;
}
