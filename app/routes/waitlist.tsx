import { redirect } from "react-router";

/** Alias people will type. Canonical page is /app. */
export function loader() {
  return redirect("/app", 301);
}
