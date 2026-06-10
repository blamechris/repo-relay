import { describe, it, expect } from 'vitest';
import { mapCiStatus, type WorkflowRunPayload } from '../ci.js';

type Conclusion = WorkflowRunPayload['workflow_run']['conclusion'];

describe('mapCiStatus', () => {
  describe('completed runs — full conclusion matrix', () => {
    const cases: Array<[Conclusion, string]> = [
      ['success', 'success'],
      // Deliberate choice: informational outcomes render as success
      ['neutral', 'success'],
      ['skipped', 'success'],
      // These are real failures and must never render as "✅ Passed"
      ['failure', 'failure'],
      ['timed_out', 'failure'],
      ['startup_failure', 'failure'],
      // Terminated without a verdict
      ['cancelled', 'cancelled'],
      ['stale', 'cancelled'],
      // Blocked waiting on approval — not a pass, not a fail
      ['action_required', 'pending'],
    ];

    it.each(cases)('completed + %s → %s', (conclusion, expected) => {
      expect(mapCiStatus('completed', conclusion)).toBe(expected);
    });

    it('unknown future conclusion values fail safe (never render as success)', () => {
      expect(mapCiStatus('completed', 'some_new_conclusion' as Conclusion)).toBe('failure');
    });

    it('null conclusion on a completed run fails safe', () => {
      expect(mapCiStatus('completed', null)).toBe('failure');
    });
  });

  describe('non-completed runs', () => {
    it('in_progress → running', () => {
      expect(mapCiStatus('in_progress', null)).toBe('running');
    });

    it('queued → pending', () => {
      expect(mapCiStatus('queued', null)).toBe('pending');
    });
  });
});
