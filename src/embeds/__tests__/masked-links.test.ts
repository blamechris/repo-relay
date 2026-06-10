import { describe, it, expect } from 'vitest';
import { buildIssueEmbed, buildPushEmbed, buildReleaseEmbed } from '../builders.js';

// Matches a renderable masked link: an UNESCAPED [ followed by ](
// (\[text](url) does not render — the escape is what we assert)
const RENDERABLE_MASKED_LINK = /(?<!\\)\[[^\]]*\]\(/;

describe('masked-link escaping in embed descriptions', () => {
  // Discord renders [text](url) masked links inside embed descriptions —
  // untrusted GitHub content must not produce disguised clickable links.
  const phish = 'Click [Verify your Discord account](https://evil.example) now';

  it('issue bodies cannot render masked links', () => {
    const embed = buildIssueEmbed({
      number: 1,
      title: 'Innocent issue',
      url: 'https://github.com/test/repo/issues/1',
      author: 'attacker',
      state: 'open',
      labels: [],
      body: phish,
      createdAt: '2024-01-01T00:00:00Z',
    }).toJSON();

    expect(embed.description).not.toMatch(RENDERABLE_MASKED_LINK);
    expect(embed.description).toContain('Verify your Discord account');
  });

  it('release notes cannot render masked links', () => {
    const embed = buildReleaseEmbed(
      'v1.0.0',
      'v1.0.0',
      'https://github.com/test/repo/releases/v1',
      'attacker',
      undefined,
      phish
    ).toJSON();
    expect(embed.description).not.toMatch(RENDERABLE_MASKED_LINK);
  });

  it('push commit messages cannot render masked links', () => {
    const embed = buildPushEmbed(
      'main',
      [{ id: 'abc1234def', message: phish }],
      'attacker',
      'https://avatar.url/a.png',
      'https://github.com/test/repo/compare/a...b'
    ).toJSON();
    expect(embed.description).not.toMatch(RENDERABLE_MASKED_LINK);
    expect(embed.description).toContain('Verify your Discord account');
  });
});
