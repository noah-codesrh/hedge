import { parseWaitlistEmail } from "../waitlist";
import { supabaseAdmin } from "./supabase";

const UNIQUE_VIOLATION = "23505";

export async function joinWaitlist(raw: string) {
  const email = parseWaitlistEmail(raw);
  if (!email) {
    return { error: "Enter a valid email.", status: 400 as const };
  }

  const db = supabaseAdmin();
  if (!db) {
    return { error: "Waitlist is not connected yet.", status: 503 as const };
  }

  const { error } = await db.from("app_waitlist").insert({ email });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: true as const, already: true };
    }
    if (error.code === "42P01") {
      return { error: "Waitlist is not connected yet.", status: 503 as const };
    }
    console.error("[waitlist] insert", error);
    return { error: "Could not save that email.", status: 502 as const };
  }
  return { ok: true as const, already: false };
}
