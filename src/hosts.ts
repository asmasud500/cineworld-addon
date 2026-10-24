/**
 * Hosts whose files are openly licensed or public domain, so a link there can be shown to viewers.
 * - archive.org and its download servers (ia800123.us.archive.org ...): public-domain / Creative Commons uploads
 * - Wikimedia Commons: free-licensed media
 * - download.blender.org: the Blender Foundation's open movies (Creative Commons)
 * A host is added only after a person has checked that it serves openly licensed content.
 */
const EXACT_HOSTS = ["archive.org", "www.archive.org", "upload.wikimedia.org", "commons.wikimedia.org", "download.blender.org"];
const SUFFIX_HOSTS = [".archive.org"];

/** Short names shown in the admin panel and in error messages. */
export const REVIEWED_HOSTS_LABEL = [...EXACT_HOSTS.filter((host) => !host.endsWith("archive.org")), "archive.org (and its download servers)"];

export function isReviewedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return EXACT_HOSTS.includes(host) || SUFFIX_HOSTS.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}
