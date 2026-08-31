import type { Route } from "./+types/api.challenge.leaderboard";
import { loadChallengeBoard } from "../lib/server/challenge-board";

let cache: { at: number; body: string } | null = null;
const CACHE_MS = 15_000;

export async function loader({}: Route.LoaderArgs) {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return new Response(cache.body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=10" },
    });
  }
  const board = await loadChallengeBoard();
  const body = JSON.stringify(board);
  cache = { at: Date.now(), body };
  return new Response(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=10" },
  });
}
