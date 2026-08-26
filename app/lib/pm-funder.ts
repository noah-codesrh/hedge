import {
  concat,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  keccak256,
  pad,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import { POLYGON_RPC } from "./chains";
import { loadDepositWallet, saveDepositWallet } from "./pm-wallet";

/** Polymarket Deposit Wallet factory (CREATE2). */
export const DEPOSIT_WALLET_FACTORY =
  "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07" as const;
/** Beacon used for wallets deployed after the June 29, 2026 upgrade. */
export const DEPOSIT_WALLET_BEACON =
  "0x7A18EDfe055488A3128f01F563e5B479D92ffc3a" as const;
/** Legacy UUPS implementation for wallets deployed before the beacon. */
const DEPOSIT_WALLET_IMPL =
  "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB" as const;

const FACTORY_BEACON_SELECTOR = "0x49493a4d";
const ERC1967_CONST1 =
  "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3";
const ERC1967_CONST2 =
  "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076";
const ERC1967_PREFIX = 0x61003d3d8160233d3973n;
const ERC1967_BEACON_CONST1 =
  "0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3";
const ERC1967_BEACON_CONST2 =
  "0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c";
const ERC1967_BEACON_CONST3 = "0x60195155f3363d3d373d3d363d602036600436635c60da";
const ERC1967_BEACON_PREFIX = 0x6100523d8160233d3973n;

function depositWalletDerivationInputs(signer: string) {
  const factory = DEPOSIT_WALLET_FACTORY;
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [factory, pad(getAddress(signer) as Hex, { dir: "left", size: 32 })],
  );
  return { args, factory, salt: keccak256(args) };
}

function deriveUupsDepositWallet(signer: string) {
  const { args, factory, salt } = depositWalletDerivationInputs(signer);
  const argLength = BigInt((args.length - 2) / 2);
  const prefix = ERC1967_PREFIX + (argLength << 56n);
  const bytecodeHash = keccak256(
    concat([
      toHex(prefix, { size: 10 }),
      DEPOSIT_WALLET_IMPL,
      "0x6009",
      ERC1967_CONST2,
      ERC1967_CONST1,
      args,
    ]),
  );
  return getCreate2Address({ from: factory, salt, bytecodeHash });
}

/** Deterministic Polymarket Deposit Wallet (beacon proxy) for a signer. */
export function deriveDepositWallet(
  signer: string,
  beacon: string = DEPOSIT_WALLET_BEACON,
) {
  const { args, factory, salt } = depositWalletDerivationInputs(signer);
  const argLength = BigInt((args.length - 2) / 2);
  const prefix = ERC1967_BEACON_PREFIX + (argLength << 56n);
  const bytecodeHash = keccak256(
    concat([
      toHex(prefix, { size: 10 }),
      getAddress(beacon) as Hex,
      ERC1967_BEACON_CONST3,
      ERC1967_BEACON_CONST2,
      ERC1967_BEACON_CONST1,
      args,
    ]),
  );
  return getCreate2Address({ from: factory, salt, bytecodeHash });
}

async function polygonRpc(method: string, params: unknown[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(POLYGON_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    if (data && typeof data === "object" && "result" in data) {
      return (data as { result: unknown }).result;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeAddress(data: unknown) {
  const hex = typeof data === "string" ? data : "";
  if (hex.length < 42) return zeroAddress;
  return getAddress(`0x${hex.slice(-40)}`);
}

function isContractCode(code: unknown) {
  return typeof code === "string" && code !== "0x" && code.length > 2;
}

/**
 * Funder that holds pUSD for CLOB orders. Never the Privy signer EOA.
 *
 * New builder accounts use the Deposit Wallet CREATE2 address. A deployed
 * legacy UUPS wallet stays authoritative if it already has code.
 * https://docs.polymarket.com/trading/wallets-auth
 */
export async function resolvePolymarketFunder(signer: string) {
  const cached = loadDepositWallet(signer);
  if (cached && cached.toLowerCase() !== signer.toLowerCase()) {
    return getAddress(cached);
  }

  const beaconWallet = deriveDepositWallet(signer);
  const uupsWallet = deriveUupsDepositWallet(signer);

  const [beacon, uupsCode] = await Promise.all([
    polygonRpc("eth_call", [
      { to: DEPOSIT_WALLET_FACTORY, data: FACTORY_BEACON_SELECTOR },
      "latest",
    ]),
    polygonRpc("eth_getCode", [uupsWallet, "latest"]),
  ]);

  const liveBeacon = beacon ? decodeAddress(beacon) : DEPOSIT_WALLET_BEACON;
  const funder =
    isContractCode(uupsCode) || liveBeacon.toLowerCase() === zeroAddress
      ? uupsWallet
      : liveBeacon.toLowerCase() === DEPOSIT_WALLET_BEACON.toLowerCase()
        ? beaconWallet
        : deriveDepositWallet(signer, liveBeacon);

  saveDepositWallet(signer, funder);
  return funder;
}
