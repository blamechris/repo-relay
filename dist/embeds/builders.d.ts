/**
 * Discord embed builders for various notification types
 */
import { EmbedBuilder } from 'discord.js';
export interface PrData {
    number: number;
    title: string;
    url: string;
    author: string;
    authorUrl: string;
    authorAvatar?: string;
    branch: string;
    baseBranch: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    body?: string;
    state: 'open' | 'closed' | 'merged';
    draft: boolean;
    createdAt: string;
    mergedAt?: string;
    mergedBy?: string;
}
export interface CiStatus {
    status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
    workflowName?: string;
    conclusion?: string;
    url?: string;
}
export interface ReviewStatus {
    copilot: 'pending' | 'reviewed';
    copilotComments?: number;
    agentReview: 'pending' | 'approved' | 'changes_requested' | 'none';
}
export declare function buildPrEmbed(pr: PrData, ci?: CiStatus, reviews?: ReviewStatus): EmbedBuilder;
export declare function buildPushReply(commitCount: number, author: string, sha: string, compareUrl?: string): string;
export declare function buildCiReply(ci: CiStatus): string;
export declare function buildReviewReply(type: 'copilot' | 'agent', status: string, comments?: number, url?: string): string;
export declare function buildMergedReply(mergedBy?: string): string;
export declare function buildClosedReply(closedBy?: string): string;
export interface IssueData {
    number: number;
    title: string;
    url: string;
    author: string;
    authorAvatar?: string;
    state: 'open' | 'closed';
    stateReason?: string | null;
    labels: string[];
    body?: string;
    createdAt: string;
}
export declare function buildIssueEmbed(issue: IssueData): EmbedBuilder;
export declare function buildIssueClosedReply(closedBy?: string, stateReason?: string | null): string;
export declare function buildIssueReopenedReply(reopenedBy?: string): string;
export declare function buildReleaseEmbed(name: string, tagName: string, url: string, author: string, authorAvatar: string | undefined, body?: string, prerelease?: boolean): EmbedBuilder;
//# sourceMappingURL=builders.d.ts.map