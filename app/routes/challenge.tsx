import { redirect } from "react-router";
import { rewardsHref } from "../lib/challenge";

export function loader() {
  return redirect(rewardsHref());
}
