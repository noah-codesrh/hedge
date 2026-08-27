import { RH_CHAIN_ID } from "./chains";

export type PrivyAuthorizationPayload = {
  version: 1;
  method: "POST";
  url: string;
  body: unknown;
  headers: {
    "privy-app-id": string;
    "privy-request-expiry"?: string;
  };
};

export type SignPrivyAuthorization = (
  payload: PrivyAuthorizationPayload,
) => Promise<string>;

async function post<T>(accessToken: string, body: unknown) {
  const res = await fetch("/api/rh/sponsor-send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) throw new Error(data?.error ?? "Could not send this token.");
  return data as T;
}

/**
 * Send an ERC-20 on Robinhood Chain with gas paid by the app.
 *
 * Two round trips because gas sponsorship is server-only in the Privy
 * dashboard: the server prepares the wallet RPC call, the user's client
 * authorizes it, then the server submits it with the app secret.
 *
 * Resolves to the transaction hash, or null when the send went through
 * without one. Only a rejected send throws: treating a missing hash as a
 * failure would report an error for tokens that have already moved.
 */
export async function sponsoredTokenSend(input: {
  accessToken: string;
  from: string;
  token: string;
  data: `0x${string}`;
  signAuthorization: SignPrivyAuthorization;
}) {
  const tx = {
    from: input.from,
    token: input.token,
    data: input.data,
    chainId: RH_CHAIN_ID,
  };

  const prepared = await post<{
    hash?: string | null;
    requestExpiry?: number;
    payload?: PrivyAuthorizationPayload;
  }>(input.accessToken, tx);

  if (typeof prepared.hash === "string" && prepared.hash.length === 66) {
    return prepared.hash;
  }
  if (!prepared.payload) {
    throw new Error("Could not authorize this wallet. Try the send again.");
  }

  const signature = await input.signAuthorization(prepared.payload);
  const submitted = await post<{ hash?: string | null }>(input.accessToken, {
    ...tx,
    signature,
    requestExpiry: prepared.requestExpiry,
  });

  return typeof submitted.hash === "string" && submitted.hash.length === 66
    ? submitted.hash
    : null;
}
