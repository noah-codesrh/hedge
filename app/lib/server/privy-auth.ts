import { PrivyClient } from "@privy-io/node";
import { serverSecrets } from "./secrets";

let client: PrivyClient | null = null;

export function privyAdmin() {
  const { privyAppId, privyAppSecret } = serverSecrets();
  if (!privyAppId || !privyAppSecret) {
    throw new Error("Privy server credentials are not configured.");
  }
  if (!client) {
    client = new PrivyClient({ appId: privyAppId, appSecret: privyAppSecret });
  }
  return client;
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function requirePrivySession(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    throw Response.json({ error: "Sign in to continue." }, { status: 401 });
  }
  try {
    const admin = privyAdmin();
    const claims = await admin.utils().auth().verifyAccessToken(token);
    return { userId: claims.user_id };
  } catch (err) {
    if (err instanceof Response) throw err;
    throw Response.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }
}

export async function requirePrivyUser(request: Request) {
  const { userId } = await requirePrivySession(request);
  try {
    const user = await privyAdmin().users()._get(userId);
    return { userId, user };
  } catch (err) {
    if (err instanceof Response) throw err;
    throw Response.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }
}

type LinkedAccounts = {
  linked_accounts?: Array<{
    type?: string;
    id?: string | null;
    address?: string;
    connector_type?: string;
    wallet_client_type?: string;
  }>;
  linkedAccounts?: Array<{
    type?: string;
    id?: string | null;
    address?: string;
    connector_type?: string;
    wallet_client_type?: string;
  }>;
  wallet?: { address?: string };
};

function accountsOf(user: LinkedAccounts) {
  return user.linked_accounts ?? user.linkedAccounts ?? [];
}

function isPrivyEmbedded(account: {
  type?: string;
  connector_type?: string;
  wallet_client_type?: string;
}) {
  if (account.type !== "wallet") return false;
  return (
    account.connector_type === "embedded" ||
    account.wallet_client_type === "privy" ||
    account.wallet_client_type === "privy-v2"
  );
}

function linkedEmbeddedWalletId(user: LinkedAccounts, address: string) {
  const target = address.toLowerCase();
  for (const account of accountsOf(user)) {
    if (!isPrivyEmbedded(account)) continue;
    if (account.address?.toLowerCase() !== target) continue;
    if (typeof account.id === "string" && account.id) return account.id;
  }
  return null;
}

/**
 * Privy wallet id for an embedded wallet this user owns, or null.
 *
 * Only embedded wallets can be driven from the server, so this doubles as the
 * ownership check before spending gas credits on someone's behalf.
 */
export async function embeddedWalletId(
  userId: string,
  address: string,
  user: LinkedAccounts,
) {
  const linked = linkedEmbeddedWalletId(user, address);
  if (linked) return linked;

  const target = address.toLowerCase();
  // Match by user, then by address. Combining user_id + address + chain_type
  // on the list call has dropped privy-v2 wallets that the user clearly owns.
  for await (const wallet of privyAdmin().wallets().list({ user_id: userId })) {
    if (wallet.address.toLowerCase() === target) return wallet.id;
  }
  return null;
}

export function linkedWalletAddresses(user: {
  linked_accounts?: Array<{ type?: string; address?: string }>;
  linkedAccounts?: Array<{ type?: string; address?: string }>;
  wallet?: { address?: string };
}) {
  const out: string[] = [];
  const add = (value?: string) => {
    const next = value?.trim() ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(next)) return;
    const lower = next.toLowerCase();
    if (!out.includes(lower)) out.push(next);
  };
  add(user.wallet?.address);
  for (const account of user.linked_accounts ?? user.linkedAccounts ?? []) {
    add(account.address);
  }
  return out;
}

export function userHasWallet(
  user: {
    linked_accounts?: Array<{ type?: string; address?: string }>;
    linkedAccounts?: Array<{ type?: string; address?: string }>;
    wallet?: { address?: string };
  },
  address: string,
) {
  const target = address.toLowerCase();
  if (user.wallet?.address?.toLowerCase() === target) return true;
  return accountsOf(user).some(
    (account) =>
      typeof account.address === "string" &&
      account.address.toLowerCase() === target,
  );
}
