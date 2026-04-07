import { describe, it, expect } from 'vitest';
import { canManageFleet, canSeeAllTrucks, hasRole } from '@/lib/auth';

describe('Chat permission helpers', () => {
  describe('canManageFleet — thread management access', () => {
    it('developer can manage fleet', () => {
      expect(canManageFleet('developer')).toBe(true);
    });

    it('manager can manage fleet', () => {
      expect(canManageFleet('manager')).toBe(true);
    });

    it('mechanic cannot manage fleet', () => {
      expect(canManageFleet('mechanic')).toBe(false);
    });

    it('operator cannot manage fleet', () => {
      expect(canManageFleet('operator')).toBe(false);
    });

    it('handles org: prefix', () => {
      expect(canManageFleet('org:developer')).toBe(true);
      expect(canManageFleet('org:operator')).toBe(false);
    });
  });

  describe('canSeeAllTrucks — determines auto-thread visibility', () => {
    it('developer sees all trucks', () => {
      expect(canSeeAllTrucks('developer')).toBe(true);
    });

    it('mechanic sees all trucks', () => {
      expect(canSeeAllTrucks('mechanic')).toBe(true);
    });

    it('operator only sees assigned trucks', () => {
      expect(canSeeAllTrucks('operator')).toBe(false);
    });
  });

  describe('hasRole — chat route access', () => {
    const chatRoles = ['developer', 'manager', 'mechanic', 'operator'] as const;

    it('all roles can access chat', () => {
      for (const role of chatRoles) {
        expect(hasRole(role, [...chatRoles])).toBe(true);
      }
    });

    it('undefined role is denied', () => {
      expect(hasRole(undefined, [...chatRoles])).toBe(false);
    });
  });
});
