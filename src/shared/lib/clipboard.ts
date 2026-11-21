/** The notice for a copy that did not reach the clipboard (the same words everywhere). */
export const COPY_FAILED = "Copy failed";

/**
 * Copies text and says whether it reached the clipboard. The Clipboard API only exists on a
 * secure page (https, localhost); on a LAN address over http, or when the browser refuses it, a
 * hidden textarea with execCommand("copy") is tried instead. False when neither worked, so the
 * caller shows COPY_FAILED instead of "copied".
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, the page lost focus): try the fallback below.
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off screen and out of the layout, so the page does not jump while it is selected.
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    focused?.focus();
  }
}
