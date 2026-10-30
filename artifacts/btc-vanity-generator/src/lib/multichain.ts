import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

export type MultiChainName = 'btc' | 'eth' | 'bnb' | 'polygon';

export const MULTI_CHAIN_OPTIONS = [
  { id: 'btc', label: 'Bitcoin', symbol: 'BTC', coinType: 0 },
  { id: 'eth', label: 'Ethereum', symbol: 'ETH', coinType: 60 },
  { id: 'bnb', label: 'BNB Smart Chain', symbol: 'BNB', coinType: 714 },
  { id: 'polygon', label: 'Polygon', symbol: 'POL', coinType: 966 },
] as const satisfies readonly {
  id: MultiChainName;
  label: string;
  symbol: string;
  coinType: number;
}[];

export const CHAIN_RPC_URLS: Record<Exclude<MultiChainName, 'btc'>, string> = {
  eth: 'https://cloudflare-eth.com',
  bnb: 'https://bsc-dataseed.binance.org',
  polygon: 'https://polygon-rpc.com',
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes)}`);
}

function base58Encode(value: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = bytesToBigInt(value);
  let result = '';
  while (number > 0n) {
    const remainder = Number(number % 58n);
    result = alphabet[remainder] + result;
    number /= 58n;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === 0) {
    leadingZeroes += 1;
  }
  return `${'1'.repeat(leadingZeroes)}${result}`;
}

function publicKeyToLegacyBitcoinAddress(publicKey: Uint8Array): string {
  const publicKeyHash = ripemd160(sha256(publicKey));
  const payload = new Uint8Array(21);
  payload[0] = 0x00;
  payload.set(publicKeyHash, 1);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const addressBytes = new Uint8Array(payload.length + checksum.length);
  addressBytes.set(payload);
  addressBytes.set(checksum, payload.length);
  return base58Encode(addressBytes);
}

export function publicKeyToEvmAddress(publicKey: Uint8Array): string {
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false).slice(1);
  const hash = keccak_256(uncompressed);
  return `0x${Array.from(hash.slice(-20), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function normalizePrivateKeyHex(value: string): Uint8Array {
  const raw = value.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('Private key must be a 32-byte hex value.');
  }
  return Uint8Array.from(
    raw.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
}

export function getMultiChainAddress(privateKeyHex: string, chain: MultiChainName): string {
  if (chain === 'btc') {
    const privateKey = normalizePrivateKeyHex(privateKeyHex);
    const publicKey = secp256k1.getPublicKey(privateKey, true);
    return publicKeyToLegacyBitcoinAddress(publicKey);
  }
  const privateKey = normalizePrivateKeyHex(privateKeyHex);
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return publicKeyToEvmAddress(publicKey);
}

// الدالة الجديدة اللي زدناها باش الـ Worker يقدر يستعملها ديريكت
export function deriveAddressFromPrivateKey(privateKey: Uint8Array, chain: MultiChainName): string {
  const privateKeyHex = bytesToHex(privateKey);
  return getMultiChainAddress(privateKeyHex, chain);
}

export function getMultiChainAddressFromHdKey(
  hdKey: HDKey,
  chain: MultiChainName,
  index: number,
): string {
  const path = getHdDerivationPath(chain, index);
  const derived = hdKey.derive(path);
  if (!derived.publicKey) {
    throw new Error(`No public key was available at index ${index}.`);
  }
  if (chain === 'btc') {
    return publicKeyToLegacyBitcoinAddress(derived.publicKey);
  }
  return publicKeyToEvmAddress(derived.publicKey);
}

export function getHdDerivationPath(chain: MultiChainName, index: number): string {
  if (chain === 'btc') return `m/0/0/${index}`;
  const coinType = MULTI_CHAIN_OPTIONS.find((option) => option.id === chain)?.coinType ?? 60;
  return `m/44'/${coinType}'/0'/0/${index}`;
}

export function isValidEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export type EvmTokenBalance = {
  address: string;
  balanceWei: bigint;
  balanceEth: string;
};

export async function fetchEvmBalanceBatch(
  chain: Exclude<MultiChainName, 'btc'>,
  addresses: string[],
  signal?: AbortSignal,
): Promise<EvmTokenBalance[]> {
  const rpcUrl = CHAIN_RPC_URLS[chain];
  const payload = addresses.map((address, index) => ({
    jsonrpc: '2.0',
    id: index + 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  }));

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`RPC request failed for ${chain.toUpperCase()} with HTTP ${response.status}.`);
  }

  const json = (await response.json()) as Array<{ result?: string; error?: { message?: string } }>;
  const results: EvmTokenBalance[] = [];

  for (let index = 0; index < addresses.length; index += 1) {
    const item = json[index];
    const raw = item?.result;
    if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw)) continue;
    const balanceWei = BigInt(raw);
    if (balanceWei > 0n) {
      results.push({
        address: addresses[index],
        balanceWei,
        balanceEth: (Number(balanceWei) / 1e18).toFixed(8),
      });
    }
  }

  return results;
   }
