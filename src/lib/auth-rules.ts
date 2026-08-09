// Pure sign-in rules, kept dependency-free so they can be unit tested.

/** Parse a comma-separated setting into trimmed, lowercased entries. */
export function parseList(value: string): string[] {
  return value
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Domain allowlist for sign-in. With a public IdP (e.g. Google with an
 * external consent screen) *any* account can complete OAuth — this is the
 * server-side gate that keeps strangers out. Admin emails always pass so a
 * consultant on another domain can be invited explicitly.
 */
export function isEmailAllowed(
  email: string,
  config: { adminEmails: string[]; allowedDomains: string[] },
): boolean {
  const normalized = email.toLowerCase();
  if (config.allowedDomains.length === 0) return true;
  if (config.adminEmails.includes(normalized)) return true;
  const domain = normalized.split("@")[1] ?? "";
  return config.allowedDomains.includes(domain);
}
