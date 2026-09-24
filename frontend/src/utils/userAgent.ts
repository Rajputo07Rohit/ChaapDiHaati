/** Lightweight, dependency-free parse of a browser's User-Agent string into
 * a human label like "iPhone · Safari" or "Windows · Chrome" — good enough
 * for "which device did this login come from", not meant to be precise. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";

  let os = "Unknown OS";
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Unknown browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/CriOS/i.test(ua)) browser = "Chrome"; // Chrome on iOS
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/FxiOS/i.test(ua)) browser = "Firefox"; // Firefox on iOS
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  return `${os} · ${browser}`;
}
