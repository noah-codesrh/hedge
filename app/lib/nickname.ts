const KEY = (userId: string) => `hedge:nickname:${userId}`;

export type NameUser = {
  id?: string;
  customMetadata?: unknown;
  twitter?: { username?: string | null } | null;
  discord?: { username?: string | null } | null;
  google?: { name?: string | null; email?: string | null } | null;
  email?: { address?: string | null } | null;
} | null;

export function readNickname(userId: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY(userId)) ?? "";
  } catch {
    return "";
  }
}

/** Local nickname, then Privy metadata, then the login identity. Empty if none. */
export function identityName(user: NameUser) {
  if (!user?.id) return "";
  const stored = readNickname(user.id).trim();
  const meta = (user.customMetadata as { nickname?: string } | undefined)
    ?.nickname?.trim();
  const twitter = user.twitter?.username?.trim();
  const discord = user.discord?.username?.trim();
  const google =
    user.google?.name?.trim() || user.google?.email?.split("@")[0]?.trim();
  const email = user.email?.address?.split("@")[0]?.trim();
  return stored || meta || twitter || discord || google || email || "";
}

export function writeNickname(userId: string, nickname: string) {
  window.localStorage.setItem(KEY(userId), nickname.trim());
}

export function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 65% 55%), hsl(${(h + 80) % 360} 70% 45%))`;
}
