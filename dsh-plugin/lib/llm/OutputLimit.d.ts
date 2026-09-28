import type { ProviderConfig, OutputLimit } from '../shared/types';
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
declare let observer: ((provider: ProviderConfig, limit: OutputLimit) => Promise<void>) | undefined;
export declare const outputLimitKey: (p: ProviderConfig) => string;
export declare function setOutputLimitObserver(fn: typeof observer): void;
export declare function knownOutputLimit(p: ProviderConfig): OutputLimit | undefined;
export declare function rememberOutputLimit(p: ProviderConfig, value: number | null, source: string): Promise<OutputLimit>;
/** Only explicit output-token bounds count; context-window size is a different limit. */
export declare function parseOutputLimitError(message: string): number | null;
export declare function detectOutputLimit(p: ProviderConfig, fetcher?: Fetcher, force?: boolean): Promise<OutputLimit>;
export {};
