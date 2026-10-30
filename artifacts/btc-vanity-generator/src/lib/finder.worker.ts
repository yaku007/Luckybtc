/// <reference lib="webworker" />

import { 
  deriveBitcoinAddress, 
  privateKeyFromRangeValue,
  privateKeyToHex
} from './bitcoin';
import { deriveAddressFromPrivateKey } from './multichain';

self.onmessage = async (event) => {
  const { startHex, endHex, targetAddress, chain } = event.data;
  let current = BigInt(`0x${startHex}`);
  const end = BigInt(`0x${endHex}`);
  const startedAt = performance.now();
  let attempts = 0;

  for (let i = current; i <= end; i++) {
    try {
      const key = privateKeyFromRangeValue(i);
      
      let address = "";
      let privateKeyWif = "";
      
      // هنا كنختارو الخوارزمية على حساب الشبكة
      if (chain === "eth" || chain === "bnb" || chain === "polygon") {
        address = deriveAddressFromPrivateKey(key, chain);
        // EVM ماعندهاش WIF، غير HEX
      } else {
        const result = deriveBitcoinAddress(key, 'legacy');
        address = result.address;
        privateKeyWif = result.privateKeyWif;
      }

      if (address === targetAddress.trim()) {
        self.postMessage({ 
          type: 'found', 
          result: { 
            index: i.toString(), 
            address: address, 
            privateKeyHex: privateKeyToHex(key), 
            privateKeyWif: privateKeyWif 
          } 
        });
        return;
      }

      attempts++;
      if (attempts % 5000 === 0) {
        const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
        self.postMessage({
          type: 'progress',
          index: i.toString(),
          address: address,
          keysPerSecond: Math.floor(attempts / elapsedSeconds),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (e) {
      // ignore
    }
  }
  self.postMessage({ type: 'exhausted' });
};
