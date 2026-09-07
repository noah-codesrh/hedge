/** Shared email check for the app waitlist form and the POST handler. */

const EMAIL =
  /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

export function parseWaitlistEmail(raw: string | null | undefined) {
  const email = (raw ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!EMAIL.test(email)) return null;
  return email;
}
