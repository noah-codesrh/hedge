import { fetchHedgeBurns, fetchHedgePair } from "../lib/hedge-token";

export async function loader() {
  const [pair, burns] = await Promise.all([fetchHedgePair(), fetchHedgeBurns()]);
  return { pair, burns };
}
