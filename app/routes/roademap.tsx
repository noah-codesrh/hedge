import { redirect } from "react-router";

/** Alias for the misspelling people will type. Canonical page is /roadmap. */
export function loader() {
  return redirect("/roadmap", 301);
}
