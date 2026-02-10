/**
 * Discord embed builders for various notification types
 */
import { EmbedBuilder, ButtonBuilder, ActionRowBuilder } from 'discord.js';
import type { FailedStep } from '../github/ci.js';
import type { DependabotAlertPayload, SecretScanningAlertPayload, CodeScanningAlertPayload } from '../handlers/security.js';
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
export declare function buildPrComponents(prUrl: string, ciUrl?: string): ActionRowBuilder<ButtonBuilder>;
export declare function buildPushReply(commitCount: number, author: string, sha: string, compareUrl?: string): string;
export declare function buildCiReply(ci: CiStatus): string;
export declare function buildCiFailureReply(ci: CiStatus, failedSteps: FailedStep[]): string;
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
export declare function buildDeploymentEmbed(state: 'success' | 'failure' | 'error' | 'pending' | 'in_progress' | 'queued' | 'inactive', environment: string, ref: string, sha: string, author: string, authorAvatar: string | undefined, description?: string, targetUrl?: string): EmbedBuilder;
export declare function buildPushEmbed(branch: string, commits: Array<{
    id: string;
    message: string;
}>, sender: string, senderAvatar: string, compareUrl: string): EmbedBuilder;
export declare function buildForcePushEmbed(branch: string, beforeSha: string, afterSha: string, sender: string, senderAvatar: string, compareUrl: string): EmbedBuilder;
export declare function buildDependabotAlertEmbed(payload: DependabotAlertPayload): EmbedBuilder;
export declare function buildSecretScanningAlertEmbed(payload: SecretScanningAlertPayload): EmbedBuilder;
export declare function buildCodeScanningAlertEmbed(payload: CodeScanningAlertPayload): EmbedBuilder;
export interface PrFooterMetadata {
    type: 'pr';
    pr: number;
    repo: string;
    ci: CiStatus['status'];
    copilot: ReviewStatus['copilot'];
    copilotComments?: number;
    agent: ReviewStatus['agentReview'];
}
export interface IssueFooterMetadata {
    type: 'issue';
    issue: number;
    repo: string;
}
export type FooterMetadata = PrFooterMetadata | IssueFooterMetadata;
export declare function parseFooterMetadata(footerText: string): FooterMetadata | null;
//# sourceMappingURL=builders.d.ts.map