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

export function userHasWallet(
  user: { linked_accounts?: Array<{ type?: string; address?: string }> },
  address: string,
) {
  const target = address.toLowerCase();
  return (user.linked_accounts ?? []).some(
    (account) =>
      typeof account.address === "string" &&
      account.address.toLowerCase() === target,
  );
}
