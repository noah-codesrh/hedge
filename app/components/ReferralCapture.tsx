import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSearchParams } from "react-router";
import { requireAccessToken } from "../lib/privy-session";
import { captureReferralCode, readStoredRef } from "../lib/referral";

/** Stick the first ?ref= in a cookie, then bind it on login. */
export function ReferralCapture() {
  const [params] = useSearchParams();
  useEffect(() => {
    captureReferralCode(params.get("ref"));
  }, [params]);
  return null;
}

export function ReferralBind() {
  const { authenticated, ready, getAccessToken } = usePrivy();
  useEffect(() => {
    if (!ready || !authenticated) return;
    const code = readStoredRef();
    if (!code) return;
    let cancelled = false;
    void (async () => {
      const token = await requireAccessToken(getAccessToken);
      if (!token || cancelled) return;
      await fetch("/api/referral/bind", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
        keepalive: true,
      }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken, ready]);
  return null;
}
