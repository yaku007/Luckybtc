/// <reference lib="webworker" />

import {
  deriveBitcoinAddress,
  deriveBitcoinAddressOnly,
  PRIVATE_KEY_LIMIT,
  privateKeyFromRangeValue,
  randomPrivateKey,
  privateKeyToHex,
} from "./bitcoin";
import { deriveEvmAddress } from "./multichain"; // <--- زدنا هادي
import {
  CANDIDATE_BATCH_SIZE,
  MAX_RECORDED_RANGE_CANDIDATES,
  type CandidateRecord,
  type WorkerRequest,
  type WorkerResponse,
} from "./vanity-protocol";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

let stopRequested = false;
let running = false;

function matches(address: string, prefix: string, suffix: string, targetAddress: string): boolean {
  if (targetAddress) return address === targetAddress;
  return address.startsWith(prefix) && address.endsWith(suffix);
}

function parseRangeValue(value: string | undefined, label: string): bigint {
  const normalized = (value ?? "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{1,64}$/.test(normalized)) {
    throw new Error(`${label} must be a hexadecimal value.`);
  }
  const parsed = BigInt(`0x${normalized}`);
  if (parsed < 1n || parsed >= PRIVATE_KEY_LIMIT) {
    throw new Error(`${label} is outside the valid range.`);
  }
  return parsed;
}

worker.onmessage = (event) => {
  if (event.data.type === "stop") {
    stopRequested = true;
    return;
  }
  if (running) return;

  const options = event.data;
  const startedAt = performance.now();
  stopRequested = false;
  running = true;

  void (async () => {
    let attempts = 0;
    let start = 0n;
    let end = 0n;
    let cursor = 0n;
    let pendingCandidates: CandidateRecord[] = [];

    try {
      if (options.mode === "range") {
        start = parseRangeValue(options.startHex, "Start of range");
        end = parseRangeValue(options.endHex, "End of range");
        cursor = start;
      }

      const rangeSize = options.mode === "range" ? end - start + 1n : 0n;
      const candidateLimit = options.candidateLimit ?? MAX_RECORDED_RANGE_CANDIDATES;
      let lastReportAt = 0;
      
      const flushCandidates = () => {
        if (pendingCandidates.length === 0) return;
        worker.postMessage({ type: "candidates", candidates: pendingCandidates });
        pendingCandidates = [];
      };

      while (!stopRequested) {
        for (let count = 0; count < 2000 && !stopRequested; count += 1) { // زدنا السرعة لـ 2000
          if (options.mode === "range" && cursor > end) {
            flushCandidates();
            worker.postMessage({ type: options.generateOnly ? "generated" : "exhausted", attempts, elapsedMs: Math.max(1, performance.now() - startedAt) });
            return;
          }

          const key = options.mode === "range" ? privateKeyFromRangeValue(cursor++) : randomPrivateKey();
          
          // --- هنا فين كيتم اختيار الخوارزمية على حساب الشبكة ---
          let address = "";
          let result: any = undefined;

          if (options.chain === "eth" || options.chain === "bnb" || options.chain === "polygon") {
            address = deriveEvmAddress(key);
            result = { address, privateKeyWif: "", privateKeyHex: privateKeyToHex(key) };
          } else {
            result = deriveBitcoinAddress(key, options.format);
            address = result.address;
          }
          // --------------------------------------------------------

          attempts += 1;

          if (options.mode === "range") {
            pendingCandidates.push({
              index: (options.candidateOffset ?? 0) + attempts,
              address,
              privateKeyWif: result.privateKeyWif,
              rangeStartHex: start.toString(16),
              rangeEndHex: end.toString(16),
            });
            if (pendingCandidates.length >= CANDIDATE_BATCH_SIZE) flushCandidates();
          }

          if (!options.generateOnly && matches(address, options.prefix, options.suffix, options.targetAddress ?? "")) {
            flushCandidates();
            worker.postMessage({ type: "found", attempts, elapsedMs: Math.max(1, performance.now() - startedAt), result });
            return;
          }
        }

        const now = performance.now();
        if (now - lastReportAt >= 200) {
          const percent = options.mode === "range" ? Math.min(100, Number(((cursor - start) * 1_000_000n) / rangeSize) / 10_000) : null;
          worker.postMessage({ type: "progress", attempts, elapsedMs: Math.max(1, performance.now() - startedAt), percent });
          lastReportAt = now;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      flushCandidates();
      worker.postMessage({ type: "stopped", attempts, elapsedMs: Math.max(1, performance.now() - startedAt) });
    } catch (error) {
      worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Search failed." });
    } finally {
      running = false;
    }
  })();
};
