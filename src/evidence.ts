/**
 * Works out the public page that shows the rights information for a link, so the editor does not have to paste it.
 * archive.org/download/<item>/file  ->  archive.org/details/<item>
 * upload.wikimedia.org/.../<File>   ->  commons.wikimedia.org/wiki/File:<File>
 * Returns null when the page cannot be worked out.
 */
export function deriveEvidenceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if ((host === "archive.org" || host === "www.archive.org") && parts[0] === "download" && parts[1]) {
      return `https://archive.org/details/${encodeURIComponent(parts[1])}`;
    }
    if (host === "upload.wikimedia.org" && parts.length >= 2) {
      const thumb = parts.indexOf("thumb");
      const file = thumb >= 0 ? parts[thumb + 3] : parts[parts.length - 1];
      if (file) return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;
    }
  } catch { /* not a valid URL */ }
  return null;
}
