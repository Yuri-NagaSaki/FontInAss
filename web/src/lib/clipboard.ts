/**
 * Copy text to clipboard using the modern Clipboard API with a
 * textarea fallback for older browsers / non-HTTPS contexts.
 */
export function copyToClipboard(text: string): boolean {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  // Fallback: hidden textarea + execCommand
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
