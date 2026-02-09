/**
 * Pre-filter: skip events before Discord gateway connect to save sessions.
 *
 * These checks approximate the corresponding handlers' early-exit conditions
 * so we avoid burning a gateway session for payloads likely to be discarded.
 */
import type { GitHubEventPayload } from './index.js';
/**
 * Returns a human-readable skip reason if the event can be discarded
 * without connecting to Discord, or `null` if it should be processed.
 */
export declare function shouldSkipEvent(eventData: GitHubEventPayload): string | null;
//# sourceMappingURL=pre-filter.d.ts.map