import { describe, it, expect } from 'vitest';
import { REPO_NAME_PATTERN } from '../utils/validation.js';

describe('REPO_NAME_PATTERN', () => {
  const valid = [
    'owner/repo',
    'my-org/my.repo',
    'user_1/repo-2',
    'Owner/Repo',
    'a/b',
    'foo-bar/baz_qux.v2',
  ];

  const invalid = [
    '../etc/passwd',
    'owner',
    'a/b/c',
    '',
    'a/<script>',
    '/repo',
    'owner/',
    'owner/repo name',
    'owner/repo\n',
    'owner/repo;rm -rf /',
  ];

  it.each(valid)('accepts valid repo name: %s', (name) => {
    expect(REPO_NAME_PATTERN.test(name)).toBe(true);
  });

  it.each(invalid)('rejects invalid repo name: %s', (name) => {
    expect(REPO_NAME_PATTERN.test(name)).toBe(false);
  });
});
