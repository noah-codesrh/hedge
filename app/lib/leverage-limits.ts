import type { LeverageOrder } from "./leverage-chain";

export type RestingOpen = {
  wallet: string;
  marketSlug: string;
  isLong: boolean;
  margin: number;
  leverage: number;
  limitPrice: number;
};

export type RestingClose = {
  wallet: string;
  marketSlug: string;
  isLong: boolean;
  triggerAbove: boolean;
  limitPrice: number;
  positionId: string;
};

async function call<T>(
  accessToken: string,
  method: string,
  body?: unknown,
  query?: string,
): Promise<T> {
  const res = await fetch(
    `/api/leverage/orders${query ? `?${query}` : ""}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    throw new Error(data?.error ?? "Could not update that limit.");
  }
  return data as T;
}

export async function listRestingOrders(accessToken: string) {
  const data = await call<{ orders: LeverageOrder[] }>(accessToken, "GET");
  return data.orders ?? [];
}

export async function restOpenOrder(accessToken: string, input: RestingOpen) {
  return call(accessToken, "POST", { kind: "open", ...input });
}

export async function restCloseOrder(accessToken: string, input: RestingClose) {
  return call(accessToken, "POST", { kind: "close", ...input });
}

export async function cancelRestingOrder(accessToken: string, id: string) {
  return call(accessToken, "DELETE", undefined, `id=${encodeURIComponent(id)}`);
}

export async function markOrderFilled(accessToken: string, id: string) {
  return call(accessToken, "PATCH", { id, status: "filled" });
}
