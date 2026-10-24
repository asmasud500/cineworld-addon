/**
 * Hosts whose files are openly licensed or public domain, so a link there can be shown to viewers.
 * - archive.org and its download servers (ia800123.us.archive.org ...): public-domain / Creative Commons uploads
 * - Wikimedia Commons: free-licensed media
 * - download.blender.org: the Blender Foundation's open movies (Creative Commons)
 * A host is added only after a person has checked that it serves openly licensed content.
 */
const BUILTIN_EXACT_HOSTS = ["archive.org", "www.archive.org", "upload.wikimedia.org", "commons.wikimedia.org", "download.blender.org"];
const BUILTIN_SUFFIX_HOSTS = [".archive.org"];

/**
 * Optional operator-managed allowlist for additional hosts that serve media the operator is
 * authorized to share. Set PLAYBACK_ALLOWED_HOSTS to comma-separated hostnames (no URLs/paths).
 * Do not add a host unless the content's distribution rights have been verified.
 */
const CUSTOM_HOSTS = (process.env.PLAYBACK_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase().replace(/^https?:\\/\\//, "").replace(/\\/$/, ""))
  .filter((host) => /^[a-z0-9.-]+$/.test(host) && !host.includes(".."));
const EXACT_HOSTS = [...BUILTIN_EXACT_HOSTS, ...CUSTOM_HOSTS];
const SUFFIX_HOSTS = BUILTIN_SUFFIX_HOSTS;

/** Short names shown in the admin panel and in error messages. */
export const REVIEWED_HOSTS_LABEL = [...BUILTIN_EXACT_HOSTS.filter((host) => !host.endsWith("archive.org")), "archive.org (and its download servers)", ...CUSTOM_HOSTS.map((host) => `${host} (operator configured)`)];

export function isReviewedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return EXACT_HOSTS.includes(host) || SUFFIX_HOSTS.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}
