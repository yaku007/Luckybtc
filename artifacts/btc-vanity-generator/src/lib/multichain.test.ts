import { HDKey } from '@scure/bip32';
import { describe, expect, it } from 'vitest';
import {
  getMultiChainAddress,
  getMultiChainAddressFromHdKey,
} from './multichain';

describe('multichain wallet helpers', () => {
  const privateKeyHex = '0x' + '11'.repeat(32);

  it('derives a valid EVM address for the provided private key', () => {
    const ethAddress = getMultiChainAddress(privateKeyHex, 'eth');
    expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(getMultiChainAddress(privateKeyHex, 'bnb')).toBe(ethAddress);
  });

  it('derives a valid address from an HD key with a chain-specific path', () => {
    const hdKey = HDKey.fromMasterSeed(new Uint8Array(32).fill(7));
    const ethAddress = getMultiChainAddressFromHdKey(hdKey, 'eth', 0);
    const polygonAddress = getMultiChainAddressFromHdKey(hdKey, 'polygon', 1);

    expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(polygonAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(ethAddress).not.toBe(polygonAddress);
  });
});
