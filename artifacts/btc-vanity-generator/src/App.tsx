import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import DonationAddress from '@/components/donation-address';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import BitcoinPuzzlePage from '@/pages/bitcoin-puzzle';
import BitcoinPuzzleAddressLookupPage from '@/pages/bitcoin-puzzle-address-lookup';
import BitcoinBalancePage from '@/pages/bitcoin-balance';
import BitcoinRangeLookupPage from '@/pages/bitcoin-range-lookup';
import FinderPage from '@/pages/finder';
import SelfTestPage from '@/pages/self-test';
import { queueBalanceCheck } from '@/lib/balance-check-transfer';
import { rememberGeneratedAddressRanges } from '@/lib/range-lookup-index';
import {
  ArrowUpRight,
  Bitcoin,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Cpu,
  Download,
  Eye,
  Fingerprint,
  Globe2,
  KeyRound,
  LockKeyhole,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import {
  isValidBitcoinAddressTarget,
  PRIVATE_KEY_LIMIT,
  type AddressFormat,
} from '@/lib/bitcoin';
import {
  getMultiChainAddress,
  MULTI_CHAIN_OPTIONS,
  type MultiChainName,
} from '@/lib/multichain';
import {
  MAX_RECORDED_RANGE_CANDIDATES,
  type CandidateRecord,
  type SearchResult,
  type WorkerResponse,
} from '@/lib/vanity-protocol';
import {
  Link,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

const RANGE_RESUME_STORAGE_KEY = 'bitcoin-vanity-generator:range-resume:v1';
const MAX_CPU_WORKERS = 32;

function getMaxCpuWorkers(): number {
  const reportedCores =
    typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency;
  const availableCores =
    Number.isInteger(reportedCores) && reportedCores > 0 ? reportedCores : 2;
  const optimizedCores = Math.max(availableCores, 8); 
  return Math.max(1, Math.min(optimizedCores, MAX_CPU_WORKERS));
}

type RangeResumeSettings = {
  format: AddressFormat;
  startHex: string;
  endHex: string;
  batchSize: string;
};

type RangeResumeLoad = {
  settings: RangeResumeSettings | null;
  available: boolean;
};

function parseRangeResumeSettings(value: unknown): RangeResumeSettings | null {
  if (!value || typeof value !== 'object') return null;
  const settings = value as Record<string, unknown>;
  if (
    (settings.format !== 'legacy' && settings.format !== 'segwit') ||
    typeof settings.startHex !== 'string' ||
    !/^[0-9a-f]{1,64}$/i.test(settings.startHex) ||
    typeof settings.endHex !== 'string' ||
    !/^[0-9a-f]{1,64}$/i.test(settings.endHex)
  ) {
    return null;
  }
  const start = BigInt(`0x${settings.startHex}`);
  const end = BigInt(`0x${settings.endHex}`);
  if (start < 1n || end < start || end >= PRIVATE_KEY_LIMIT) return null;
  const fallbackBatchSize = end - start + 1n;
  const storedBatchSize =
    typeof settings.batchSize === 'string' &&
    /^\d{1,78}$/.test(settings.batchSize)
      ? BigInt(settings.batchSize)
      : fallbackBatchSize;
  if (storedBatchSize < 1n || storedBatchSize >= PRIVATE_KEY_LIMIT) return null;
  return {
    format: settings.format,
    startHex: settings.startHex,
    endHex: settings.endHex,
    batchSize: storedBatchSize.toString(),
  };
}

function readRangeResumeSettings(): RangeResumeLoad {
  if (typeof window === 'undefined') return { settings: null, available: false };
  try {
    const saved = window.sessionStorage.getItem(RANGE_RESUME_STORAGE_KEY);
    if (!saved) return { settings: null, available: true };
    const parsed: unknown = JSON.parse(saved);
    const settings = parseRangeResumeSettings(parsed);
    if (settings) return { settings, available: true };
    window.sessionStorage.removeItem(RANGE_RESUME_STORAGE_KEY);
    return { settings: null, available: true };
  } catch {
    return { settings: null, available: false };
  }
}

function parseRangeHex(value: string): bigint | null {
  const normalized = value.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,64}$/i.test(normalized)) return null;
  const parsed = BigInt(`0x${normalized}`);
  return parsed >= 1n && parsed < PRIVATE_KEY_LIMIT ? parsed : null;
}

function getRangeSize(startHex: string, endHex: string): bigint | null {
  const start = parseRangeHex(startHex);
  const end = parseRangeHex(endHex);
  if (start === null || end === null || start > end) return null;
  return end - start + 1n;
}

function formatRangeHex(value: bigint, width: number): string {
  return value.toString(16).padStart(width, '0');
}

function SiteHeader({
  activePage,
  children,
}: {
  activePage:
    | 'generator'
    | 'puzzle'
    | 'balance'
    | 'range-lookup'
    | 'finder'
    | 'self-test';
  children: ReactNode;
}) {
  return (
    <header className="topbar">
      <Link href="/" className="brand" data-testid="link-brand-home" aria-label="LUCKY BTC home">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none">
            <path d="M8 12h10M13 12v16M8 28h10" />
            <path d="M31 13c-2.2-1.6-7.3-1.9-9.8.3-3 2.6-.5 5.2 4.2 6.2 4.8 1 6.4 3.4 4.1 6.1-2.3 2.9-8.1 3-11.3 1.3" />
          </svg>
        </span>
        <span>LUCKY BTC</span>
      </Link>
      <nav className="site-nav" aria-label="Main navigation">
        <Link href="/" className={`site-nav-link ${activePage === 'generator' ? 'active' : ''}`}>Generator</Link>
        <Link href="/bitcoin-puzzle" className={`site-nav-link ${activePage === 'puzzle' ? 'active' : ''}`}>Bitcoin Puzzle</Link>
        <Link href="/balance-check" className={`site-nav-link ${activePage === 'balance' ? 'active' : ''}`}>Balance Check</Link>
        <Link href="/range-lookup" className={`site-nav-link ${activePage === 'range-lookup' ? 'active' : ''}`}>Range Lookup</Link>
        <Link href="/finder" className={`site-nav-link ${activePage === 'finder' ? 'active' : ''}`}>HD Finder</Link>
        <Link href="/self-test" className={`site-nav-link ${activePage === 'self-test' ? 'active' : ''}`}>Self-test</Link>
      </nav>
      <div className="top-meta">{children}</div>
    </header>
  );
}

function getNextRange(endHex: string, batchSize: bigint, width: number): { startHex: string; endHex: string } | null {
  const end = parseRangeHex(endHex);
  if (end === null) return null;
  const nextStart = end + 1n;
  const maximumKey = PRIVATE_KEY_LIMIT - 1n;
  if (nextStart > maximumKey) return null;
  const nextEnd = nextStart + batchSize - 1n;
  return {
    startHex: formatRangeHex(nextStart, width),
    endHex: formatRangeHex(nextEnd > maximumKey ? maximumKey : nextEnd, width),
  };
}

function saveRangeResumeSettings(settings: RangeResumeSettings): boolean {
  try {
    window.sessionStorage.setItem(RANGE_RESUME_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    try { window.sessionStorage.removeItem(RANGE_RESUME_STORAGE_KEY); } catch {}
    return false;
  }
}

function clearRangeResumeSettings(): boolean {
  try {
    window.sessionStorage.removeItem(RANGE_RESUME_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function Home() {
  const [, setLocation] = useLocation();
  const maxCpuWorkers = getMaxCpuWorkers();
  const [cpuWorkers, setCpuWorkers] = useState(maxCpuWorkers);
  const [resumeLoad] = useState(readRangeResumeSettings);
  const initialResume = resumeLoad.settings;
  
  const [mode, setMode] = useState<'secure' | 'range'>(() => initialResume ? 'range' : 'secure');
  const [target, setTarget] = useState('');
  const [exactTarget, setExactTarget] = useState('');
  const [patternPosition, setPatternPosition] = useState<'prefix' | 'suffix'>('prefix');
  const [format, setFormat] = useState<AddressFormat>(() => initialResume?.format ?? 'legacy');
  
  // هادي هي الـ State اللي كتتحكم فـ الشبكة
  const [chain, setChain] = useState<MultiChainName>('btc');

  const [rangeStart, setRangeStart] = useState(() => initialResume?.startHex ?? '');
  const [rangeEnd, setRangeEnd] = useState(() => initialResume?.endHex ?? '');
  const [continuationOriginStart, setContinuationOriginStart] = useState(() => initialResume?.startHex ?? '');
  const [continuationBatchSize, setContinuationBatchSize] = useState(() => initialResume?.batchSize ?? '');
  const [canContinueRange, setCanContinueRange] = useState(Boolean(initialResume));
  const [rangeAccepted, setRangeAccepted] = useState(Boolean(initialResume));
  const [autoContinueRange, setAutoContinueRange] = useState(true);
  const [autoResumeEnabled, setAutoResumeEnabled] = useState(Boolean(initialResume));
  const [autoResumePending, setAutoResumePending] = useState(Boolean(initialResume));
  const [notice, setNotice] = useState('');
  const [searchStatus, setSearchStatus] = useState<'ready' | 'running' | 'stopping' | 'found' | 'stopped' | 'exhausted' | 'generated' | 'limit' | 'error'>('ready');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [candidateRecords, setCandidateRecords] = useState<CandidateRecord[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [priceState, setPriceState] = useState<'loading' | 'ready' | 'error'>('loading');
  
  // الخاص بالـ Quick Helper
  const [multiChainKey, setMultiChainKey] = useState('');
  const [multiChainChain, setMultiChainChain] = useState<MultiChainName>('eth');

  const formRef = useRef<HTMLFormElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const autoContinueRangeRef = useRef(true);

  const searching = searchStatus === 'running' || searchStatus === 'stopping';
  const historyPageSize = 100;
  const historyPageCount = Math.max(1, Math.ceil(candidateRecords.length / historyPageSize));
  const historyStart = historyPage * historyPageSize;
  const visibleHistory = candidateRecords.slice(historyStart, historyStart + historyPageSize);

  useEffect(() => {
    let active = true;
    const loadPrice = async () => {
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!active || typeof result?.bitcoin?.usd !== 'number') return;
        setPrice(result.bitcoin.usd);
        setPriceChange(typeof result.bitcoin.usd_24h_change === 'number' ? result.bitcoin.usd_24h_change : null);
        setPriceState('ready');
      } catch {
        if (active) setPriceState('error');
      }
    };
    void loadPrice();
    const interval = window.setInterval(loadPrice, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => () => {
      const activeWorker = workerRef.current;
      if (activeWorker) {
        activeWorker.postMessage({ type: 'stop' });
        window.setTimeout(() => activeWorker.terminate(), 10_000);
      }
      workerRef.current = null;
  }, []);

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied to clipboard.`);
    } catch {
      setNotice('Clipboard access is unavailable in this browser.');
    }
  };

  const checkGeneratedBalances = () => {
    if (candidateRecords.length === 0 || searching || autoResumePending) return;
    queueBalanceCheck(candidateRecords.map((record) => record.address));
    setLocation('/balance-check');
  };

  const disableAutoResume = () => {
    clearRangeResumeSettings();
    setAutoResumeEnabled(false);
    setAutoResumePending(false);
    setCanContinueRange(false);
    setContinuationOriginStart('');
    setContinuationBatchSize('');
  };

  const clearResumePreference = () => {
    disableAutoResume();
    setCandidateRecords([]);
    setHistoryPage(0);
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searching) {
      workerRef.current?.postMessage({ type: 'stop' });
      disableAutoResume();
      setSearchStatus('stopping');
      return;
    }

    const normalizedExactTarget = format === 'segwit' ? exactTarget.trim().toLowerCase() : exactTarget.trim();
    
    // هاد الشرط كيتحقق غير إلا كانت الشبكة هي البيتكوين
    if (chain === 'btc' && normalizedExactTarget && !isValidBitcoinAddressTarget(normalizedExactTarget, format)) {
      setNotice('Enter a valid mainnet Bitcoin address.');
      return;
    }

    const pattern = target.trim();
    const generateOnly = mode === 'range' && !normalizedExactTarget && !pattern;
    
    if (!normalizedExactTarget && !pattern && !generateOnly) {
      setNotice('Enter a prefix or suffix, or paste a full target address.');
      return;
    }

    if (mode === 'range' && !rangeAccepted) {
      setNotice('Confirm the custom-range safety warning before continuing.');
      return;
    }

    const selectedRangeSize = generateOnly ? getRangeSize(rangeStart, rangeEnd) : null;
    if (generateOnly && selectedRangeSize === null) {
      setNotice('Enter a valid low/high range before generating addresses.');
      return;
    }

    const isContinuation = generateOnly && canContinueRange && Boolean(continuationOriginStart) && Boolean(continuationBatchSize);
    const runBatchSize = generateOnly ? (isContinuation ? BigInt(continuationBatchSize) : selectedRangeSize!) : 0n;
    const runOriginStart = isContinuation ? continuationOriginStart : rangeStart;
    const existingRecordCount = isContinuation ? candidateRecords.length : 0;
    const candidateLimit = MAX_RECORDED_RANGE_CANDIDATES - existingRecordCount;
    
    const rangeWidth = Math.max(rangeStart.replace(/^0x/i, '').length, rangeEnd.replace(/^0x/i, '').length);
    const rangeResumeSaved = generateOnly ? saveRangeResumeSettings({ format, startHex: runOriginStart, endHex: rangeEnd, batchSize: runBatchSize.toString() }) : false;
    
    if (!generateOnly) {
      clearRangeResumeSettings();
      setContinuationOriginStart('');
      setContinuationBatchSize('');
    }
    
    setAutoResumeEnabled(rangeResumeSaved);
    setAutoResumePending(false);
    if (generateOnly) {
      setContinuationOriginStart(runOriginStart);
      setContinuationBatchSize(runBatchSize.toString());
    }
    setCanContinueRange(false);

    workerRef.current?.terminate();
    setResult(null);
    if (!isContinuation) {
      setCandidateRecords([]);
      setHistoryPage(0);
    }
    setShowPrivateKey(false);
    setAttempts(0);
    setElapsedMs(0);
    setProgressPercent(mode === 'range' ? 0 : null);
    setNotice('');

    try {
      const worker = new Worker(new URL('./lib/vanity-coordinator.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if ('attempts' in message) setAttempts(message.attempts);
        if ('elapsedMs' in message) setElapsedMs(message.elapsedMs);

        if (message.type === 'candidates') {
          rememberGeneratedAddressRanges(message.candidates);
          setCandidateRecords((prev) => [...prev, ...message.candidates].sort((l, r) => l.index - r.index));
        } else if (message.type === 'progress') {
          setProgressPercent(message.percent);
          setSearchStatus('running');
        } else if (message.type === 'found') {
          setResult(message.result);
          setProgressPercent(100);
          setSearchStatus('found');
          setNotice('Target found! The search stopped.');
          worker.terminate();
        } else if (message.type === 'exhausted') {
          setProgressPercent(100);
          setSearchStatus('exhausted');
          setNotice('The entire selected range was checked; no match.');
          worker.terminate();
        } else if (message.type === 'stopped') {
          setSearchStatus('stopped');
          setNotice('Search stopped by user.');
          worker.terminate();
        } else if (message.type === 'error') {
          setSearchStatus('error');
          setNotice(message.message);
          worker.terminate();
        }
      };

      worker.onerror = () => {
        setSearchStatus('error');
        setNotice('Worker error.');
        worker.terminate();
      };

      setSearchStatus('running');
      worker.postMessage({
        type: 'start',
        mode: mode === 'range' ? 'range' : 'random',
        format,
        chain, // <--- هنا كنصيفطو الشبكة
        prefix: normalizedExactTarget ? '' : (patternPosition === 'prefix' ? (chain === 'btc' ? `1${pattern}` : '') : ''),
        suffix: normalizedExactTarget || patternPosition === 'prefix' ? '' : pattern,
        targetAddress: normalizedExactTarget || undefined,
        startHex: rangeStart,
        endHex: rangeEnd,
        generateOnly,
        candidateLimit: mode === 'range' ? candidateLimit : undefined,
        candidateOffset: existingRecordCount,
        workerCount: cpuWorkers,
      });
    } catch {
      setSearchStatus('error');
      setNotice('Could not start worker.');
    }
  };

  const formattedPrice = price === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(price);
  const multiChainAddress = multiChainKey.trim() ? (() => { try { return getMultiChainAddress(multiChainKey, multiChainChain); } catch { return ''; } })() : '';

  return (
    <div className="app-shell">
      <SiteHeader activePage="generator">
        <span>LOCAL KEY GENERATION</span>
        <div className="price-line" data-testid="text-live-btc-price">
          <span className="price-dot" />
          <span>BTC {formattedPrice}</span>
        </div>
      </SiteHeader>

      <main className="page-wrap">
        <section className="intro">
          <div className="eyebrow">A tool for your own keys</div>
          <h1>Make an address<br />that feels like yours.</h1>
          <p className="intro-copy">Search locally for an address with a pattern you choose. Your keys stay in this browser.</p>
        </section>

        <section className="workspace" aria-label="Address search">
          <form ref={formRef} className="panel search-panel" onSubmit={handleSearch}>
            <div className="panel-heading">
              <div>
                <div className="section-kicker"><span className="step-number">01</span> Set your search</div>
              </div>
              <div className="mode-switch" role="group">
                <button type="button" disabled={searching} className={`mode-option ${mode === 'secure' ? 'active' : ''}`} onClick={() => { clearResumePreference(); setMode('secure'); setRangeAccepted(false); }}>Auto · secure</button>
                <button type="button" disabled={searching} className={`mode-option ${mode === 'range' ? 'active' : ''}`} onClick={() => { clearResumePreference(); setMode('range'); }}>Custom range</button>
              </div>
            </div>

            {/* زدنا هنا اختيار الشبكة فـ الفورم */}
            <div className="field-grid">
              <div>
                <label className="field-label">Blockchain Network</label>
                <div className="select-wrap">
                  <select className="select-control" value={chain} disabled={searching} onChange={(event) => { clearResumePreference(); setChain(event.target.value as MultiChainName); }}>
                    {MULTI_CHAIN_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label} ({option.symbol})</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </div>
              </div>
              
              {chain === 'btc' && (
                <div>
                  <label className="field-label">Address format</label>
                  <div className="select-wrap">
                    <select className="select-control" value={format} disabled={searching} onChange={(event) => { clearResumePreference(); setFormat(event.target.value as AddressFormat); }}>
                      <option value="legacy">Legacy · P2PKH (1…)</option>
                      <option value="segwit">Native SegWit · Bech32 (bc1q…)</option>
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </div>
                </div>
              )}
            </div>

            <label className="field-label" htmlFor="exact-address">Exact full {chain.toUpperCase()} address (optional)</label>
            <div className="input-row">
              <input
                id="exact-address"
                className="target-input"
                value={exactTarget}
                onChange={(event) => { clearResumePreference(); setExactTarget(event.target.value.trim()); }}
                disabled={searching}
                placeholder={`Paste a ${chain.toUpperCase()} address to match exactly`}
              />
            </div>

            <button className="primary-button" type="submit" disabled={searchStatus === 'stopping' || (!searching && mode === 'range' && !rangeAccepted)}>
              {searching ? <CircleAlert aria-hidden="true" /> : <Fingerprint aria-hidden="true" />}
              {searching ? 'Stop search' : 'Start local search'}
            </button>
            {notice && <div className="range-warning" role="status">{notice}</div>}
          </form>

          <aside className="side-stack">
            <section className="panel side-panel">
              <h2 className="side-title"><LockKeyhole aria-hidden="true" /> Your keys stay yours</h2>
              <ul className="privacy-list">
                <li><Check aria-hidden="true" /><span>Private keys are created on this device.</span></li>
                <li><Check aria-hidden="true" /><span>Nothing is sent to a server or saved to an account.</span></li>
              </ul>
            </section>
          </aside>
        </section>

        <section className="panel" aria-label="Multi-chain helper" style={{ marginTop: 18, padding: 22 }}>
          <div className="section-kicker"><span className="step-number">02</span> Quick multi-chain address helper</div>
          <div className="subhead" style={{ marginBottom: 12 }}>Preview an address from a private key.</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0,1.3fr) minmax(180px, 0.7fr)', alignItems: 'end' }}>
            <div>
              <label className="field-label">Private key (32-byte hex)</label>
              <input className="target-input" value={multiChainKey} onChange={(event) => setMultiChainKey(event.target.value.trim())} placeholder="Paste a 64-character hex private key" />
            </div>
            <div>
              <label className="field-label">Chain</label>
              <div className="select-wrap">
                <select className="select-control" value={multiChainChain} onChange={(event) => setMultiChainChain(event.target.value as MultiChainName)}>
                  {MULTI_CHAIN_OPTIONS.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
              </div>
            </div>
          </div>
          {multiChainKey && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: '1px solid #333', background: '#111113', overflowWrap: 'anywhere' }}>
              <div className="result-label">Derived {MULTI_CHAIN_OPTIONS.find((c) => c.id === multiChainChain)?.label}</div>
              {multiChainAddress ? <div className="address-text" style={{ marginTop: 8 }}>{multiChainAddress}</div> : <div className="range-warning">Invalid private key.</div>}
            </div>
          )}
        </section>

        <section className="panel result-panel" aria-label="Search result">
          <div className="result-head">
            <div>
              <div className="section-kicker"><span className="step-number">03</span> Search status &amp; result</div>
            </div>
            <div className={`status-pill ${searching ? 'status-running' : ''}`}><span className="status-dot" /> {searchStatus.toUpperCase()}</div>
          </div>
          
          {result && <div className="result-main" style={{ marginTop: 16 }}>
            <div className="address-box">
              <div className="result-label">Matched Address</div>
              <div className="address-text">{result.address}</div>
              <button className="small-button" type="button" onClick={() => void copyValue(result.address, 'Address')}><Copy /> Copy</button>
            </div>
            <div className="private-box">
              <div className="result-label">Private key (Hex)</div>
              <div className="private-value">{showPrivateKey ? result.privateKeyHex : '••••••••••••••••••••••••••••••••••••'}</div>
              <button className="small-button" type="button" onClick={() => setShowPrivateKey(!showPrivateKey)}><Eye /> {showPrivateKey ? 'Hide' : 'Reveal'}</button>
            </div>
          </div>}
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progressPercent ?? (searching ? 12 : 0)}%` }} /></div>
          <div className="progress-meta"><span>{attempts.toLocaleString()} checked</span><span>{elapsedMs > 0 ? `${Math.round(attempts / (elapsedMs / 1000)).toLocaleString()} keys/sec` : '— keys/sec'}</span></div>
        </section>

        <footer className="footer-note">
          <span><KeyRound aria-hidden="true" /> Never share a private key.</span>
          <DonationAddress />
        </footer>
      </main>
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  const isHome = location === '/';
  const isBitcoinPuzzle = location === '/bitcoin-puzzle';
  const isPuzzleAddressLookup = location === '/puzzle-address-lookup';
  const isBitcoinBalance = location === '/balance-check';
  const isBitcoinRangeLookup = location === '/range-lookup';
  const isFinder = location === '/finder';
  const isSelfTest = location === '/self-test';

  return (
    <RoutedErrorBoundary>
      <div hidden={!isHome}><Home /></div>
      <div hidden={!isBitcoinPuzzle} className="app-shell"><SiteHeader activePage="puzzle"><span>LOCAL PUZZLE INDEX</span></SiteHeader><BitcoinPuzzlePage active={isBitcoinPuzzle} /></div>
      <div hidden={!isPuzzleAddressLookup} className="app-shell"><SiteHeader activePage="puzzle"><span>PUZZLE ADDRESS LOOKUP</span></SiteHeader><BitcoinPuzzleAddressLookupPage active={isPuzzleAddressLookup} /></div>
      <div hidden={!isBitcoinBalance} className="app-shell"><SiteHeader activePage="balance"><span>BULK BALANCE CHECK</span></SiteHeader><BitcoinBalancePage active={isBitcoinBalance} /></div>
      <div hidden={!isBitcoinRangeLookup} className="app-shell"><SiteHeader activePage="range-lookup"><span>LOCAL RANGE LOOKUP</span></SiteHeader><BitcoinRangeLookupPage active={isBitcoinRangeLookup} /></div>
      <div hidden={!isFinder} className="app-shell"><SiteHeader activePage="finder"><span>HD ADDRESS FINDER</span></SiteHeader><FinderPage /></div>
      <div hidden={!isSelfTest} className="app-shell"><SiteHeader activePage="self-test"><span>LOCAL DIAGNOSTICS</span></SiteHeader><SelfTestPage /></div>
      {!isHome && !isBitcoinPuzzle && !isPuzzleAddressLookup && !isBitcoinBalance && !isBitcoinRangeLookup && !isFinder && !isSelfTest && (<Switch><Route component={NotFound} /></Switch>)}
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
