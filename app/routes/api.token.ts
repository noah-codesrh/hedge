import { fetchHedgePair } from "../lib/hedge-token";

export async function loader() {
  return { pair: await fetchHedgePair() };
}
