import { HDKey } from '@scure/bip32';
import { describe, expect, it } from 'vitest';
import {
  getMultiChainAddress,
  getMultiChainAddressFromHdKey,
} from './multichain';
import { findHdAddressByXpub } from './hd-address-finder';

describe('multichain wallet helpers', () => {
  const privateKeyHex = '0x' + '11'.repeat(32);

  it('derives a valid EVM address for the provided private key', () => {
    const ethAddress = getMultiChainAddress(privateKeyHex, 'eth');
    expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(getMultiChainAddress(privateKeyHex, 'bnb')).toBe(ethAddress);
  });

  it('derives the standard Ethereum address for private key one', () => {
    expect(getMultiChainAddress(`${'0'.repeat(63)}1`, 'eth')).toBe(
      '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
    );
  });

  it('derives a valid address from an HD key with a chain-specific path', () => {
    const hdKey = HDKey.fromMasterSeed(new Uint8Array(32).fill(7));
    const ethAddress = getMultiChainAddressFromHdKey(hdKey, 'eth', 0);
    const polygonAddress = getMultiChainAddressFromHdKey(hdKey, 'polygon', 1);

    expect(ethAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(polygonAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(ethAddress).not.toBe(polygonAddress);
  });

  it('matches an EVM address using an account-level xpub and index range', async () => {
    const master = HDKey.fromMasterSeed(new Uint8Array(32).fill(7));
    const accountXpub = master.derive("m/44'/60'/0'").publicExtendedKey;
    const expectedAddress = getMultiChainAddressFromHdKey(master, 'eth', 7);

    await expect(findHdAddressByXpub({
      xpub: accountXpub,
      startIndex: 5,
      endIndex: 9,
      targetAddress: expectedAddress,
      chain: 'eth',
    })).resolves.toEqual({ index: 7, address: expectedAddress });
  });

  it('rejects private extended keys in HD lookup mode', async () => {
    const xprv = HDKey.fromMasterSeed(new Uint8Array(32).fill(8)).privateExtendedKey;

    await expect(findHdAddressByXpub({
      xpub: xprv,
      startIndex: 0,
      endIndex: 0,
      targetAddress: '0x0000000000000000000000000000000000000000',
      chain: 'eth',
    })).rejects.toThrow('Enter a mainnet xpub');
  });
});
