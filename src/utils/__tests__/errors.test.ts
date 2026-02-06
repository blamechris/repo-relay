import { describe, it, expect } from 'vitest';
import { safeErrorMessage } from '../errors.js';

describe('safeErrorMessage', () => {
  it('returns .message for Error instances', () => {
    const err = new Error('something broke');
    expect(safeErrorMessage(err)).toBe('something broke');
  });

  it('does not return the stack trace', () => {
    const err = new Error('oops');
    const result = safeErrorMessage(err);
    expect(result).not.toContain('at ');
    expect(result).toBe('oops');
  });

  it('returns the string itself for string errors', () => {
    expect(safeErrorMessage('plain string')).toBe('plain string');
  });

  it('returns "null" for null', () => {
    expect(safeErrorMessage(null)).toBe('null');
  });

  it('returns "undefined" for undefined', () => {
    expect(safeErrorMessage(undefined)).toBe('undefined');
  });

  it('returns stringified object for plain objects', () => {
    expect(safeErrorMessage({ key: 'value' })).toBe('[object Object]');
  });
});
