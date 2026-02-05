import { describe, it, expect } from 'vitest';
import {
  AGENT_REVIEW_PATTERNS,
  APPROVED_PATTERNS,
  CHANGES_REQUESTED_PATTERNS,
} from '../agent-review.js';

describe('AGENT_REVIEW_PATTERNS', () => {
  const matches = [
    '## Code Review Summary',
    '## code review summary',
    '### Agent Review',
    '### agent review',
    '## 🔍 Code Review',
    '**Verdict:**',
    '**verdict:**',
    '## Review Result',
    '## Code Review: PR #42',
    '## Code Review: PR #1234',
  ];

  it.each(matches)('matches: %s', (input) => {
    const matched = AGENT_REVIEW_PATTERNS.some((p) => p.test(input));
    expect(matched).toBe(true);
  });

  const nonMatches = [
    'Just a regular comment',
    'Great work on this PR!',
    'Code review looks good',
    '# Code Review Summary',  // wrong heading level
    'Verdict: approved',       // no bold markers
    '## Code Review: PR #',    // missing number
  ];

  it.each(nonMatches)('does not match: %s', (input) => {
    const matched = AGENT_REVIEW_PATTERNS.some((p) => p.test(input));
    expect(matched).toBe(false);
  });

  it('matches patterns embedded in a larger body', () => {
    const body = `
Here is my review of the changes.

## Code Review Summary

Overall the code looks good.

**Verdict:** Approved
    `.trim();
    const matched = AGENT_REVIEW_PATTERNS.some((p) => p.test(body));
    expect(matched).toBe(true);
  });
});

describe('APPROVED_PATTERNS', () => {
  const matches = [
    '**Verdict:** Approved',
    'verdict: approved',
    '✅ Approved',
    '✅ approved - looks good',
    'LGTM',
    'lgtm',
    'Looks good to me',
    'looks good to me!',
    '[x] Approve',
    '[x] approve this PR',
  ];

  it.each(matches)('matches: %s', (input) => {
    const matched = APPROVED_PATTERNS.some((p) => p.test(input));
    expect(matched).toBe(true);
  });

  const nonMatches = [
    'I do not approve of this',
    'changes requested',
    'needs work',
    '[ ] Approve',  // unchecked checkbox
  ];

  it.each(nonMatches)('does not match: %s', (input) => {
    const matched = APPROVED_PATTERNS.some((p) => p.test(input));
    expect(matched).toBe(false);
  });
});

describe('CHANGES_REQUESTED_PATTERNS', () => {
  const matches = [
    'Changes Requested',
    'changes requested',
    '⚠️ Changes needed',
    '⚠️ changes must be made',
    'Needs changes',
    'needs changes before merging',
    '[x] Request changes',
    '[x] request changes',
  ];

  it.each(matches)('matches: %s', (input) => {
    const matched = CHANGES_REQUESTED_PATTERNS.some((p) => p.test(input));
    expect(matched).toBe(true);
  });

  const nonMatches = [
    'Approved',
    'LGTM',
    'looks good to me',
    '[ ] Request changes',  // unchecked checkbox
  ];

  it.each(nonMatches)('does not match: %s', (input) => {
    const matched = CHANGES_REQUESTED_PATTERNS.some((p) => p.test(input));
    expect(matched).toBe(false);
  });
});
