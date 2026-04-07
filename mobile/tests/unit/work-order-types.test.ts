/**
 * Tests for work order shared types and labels.
 * Ensures shared package types are correctly re-exported.
 */

import {
  STATUS_LABELS,
  PRIORITY_LABELS,
} from '../../src/types/work-order';

describe('Work Order Types', () => {
  describe('STATUS_LABELS', () => {
    it('has all 4 statuses', () => {
      expect(STATUS_LABELS).toHaveProperty('open');
      expect(STATUS_LABELS).toHaveProperty('in_progress');
      expect(STATUS_LABELS).toHaveProperty('blocked');
      expect(STATUS_LABELS).toHaveProperty('done');
    });

    it('labels are human-readable', () => {
      expect(STATUS_LABELS.open).toBe('Open');
      expect(STATUS_LABELS.in_progress).toBe('In Progress');
      expect(STATUS_LABELS.blocked).toBe('Blocked');
      expect(STATUS_LABELS.done).toBe('Done');
    });
  });

  describe('PRIORITY_LABELS', () => {
    it('has all 3 priorities', () => {
      expect(PRIORITY_LABELS).toHaveProperty('low');
      expect(PRIORITY_LABELS).toHaveProperty('normal');
      expect(PRIORITY_LABELS).toHaveProperty('urgent');
    });

    it('labels are human-readable', () => {
      expect(PRIORITY_LABELS.low).toBe('Low');
      expect(PRIORITY_LABELS.normal).toBe('Normal');
      expect(PRIORITY_LABELS.urgent).toBe('Urgent');
    });
  });
});
