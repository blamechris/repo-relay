/**
 * Retry wrapper with exponential backoff for Discord API 5xx errors.
 */
import { DiscordAPIError } from 'discord.js';
function isRetryable(error) {
    if (error instanceof DiscordAPIError) {
        return error.status >= 500;
    }
    return false;
}
export async function withRetry(fn, retries = 3, baseDelay = 1000) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            if (attempt === retries || !isRetryable(error))
                throw error;
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`[repo-relay] Discord API error, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error('Unreachable');
}
//# sourceMappingURL=retry.js.map