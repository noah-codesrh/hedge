const KEY = (userId: string) => `hedge:nickname:${userId}`;

export function readNickname(userId: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY(userId)) ?? "";
  } catch {
    return "";
  }
}

export function writeNickname(userId: string, nickname: string) {
  window.localStorage.setItem(KEY(userId), nickname.trim());
}

export function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 65% 55%), hsl(${(h + 80) % 360} 70% 45%))`;
}
