import { hasRole, cleanRole, canSeeAllTrucks, canUseAI, canIssueCommands, canManageFleet } from '../../src/types/auth';

describe('hasRole', () => {
  it('returns true for matching role', () => {
    expect(hasRole('developer', ['developer', 'manager'])).toBe(true);
    expect(hasRole('mechanic', ['mechanic'])).toBe(true);
  });

  it('returns false for non-matching role', () => {
    expect(hasRole('operator', ['developer', 'manager'])).toBe(false);
  });

  it('strips org: prefix from Clerk roles', () => {
    expect(hasRole('org:developer', ['developer'])).toBe(true);
    expect(hasRole('org:mechanic', ['mechanic', 'developer'])).toBe(true);
  });

  it('returns false for undefined role', () => {
    expect(hasRole(undefined, ['developer'])).toBe(false);
  });
});

describe('cleanRole', () => {
  it('strips org: prefix', () => {
    expect(cleanRole('org:developer')).toBe('developer');
    expect(cleanRole('org:operator')).toBe('operator');
  });

  it('returns role unchanged if no prefix', () => {
    expect(cleanRole('mechanic')).toBe('mechanic');
  });
});

describe('canSeeAllTrucks', () => {
  it('returns true for non-operator roles', () => {
    expect(canSeeAllTrucks('developer')).toBe(true);
    expect(canSeeAllTrucks('manager')).toBe(true);
    expect(canSeeAllTrucks('mechanic')).toBe(true);
  });

  it('returns false for operator', () => {
    expect(canSeeAllTrucks('operator')).toBe(false);
    expect(canSeeAllTrucks('org:operator')).toBe(false);
  });
});

describe('canUseAI', () => {
  it('returns true for dev/manager/mechanic', () => {
    expect(canUseAI('developer')).toBe(true);
    expect(canUseAI('manager')).toBe(true);
    expect(canUseAI('mechanic')).toBe(true);
  });

  it('returns false for operator', () => {
    expect(canUseAI('operator')).toBe(false);
  });

  it('handles org: prefix', () => {
    expect(canUseAI('org:mechanic')).toBe(true);
    expect(canUseAI('org:operator')).toBe(false);
  });
});

describe('canIssueCommands', () => {
  it('returns true for dev/manager/mechanic', () => {
    expect(canIssueCommands('developer')).toBe(true);
    expect(canIssueCommands('org:manager')).toBe(true);
  });

  it('returns false for operator', () => {
    expect(canIssueCommands('operator')).toBe(false);
  });
});

describe('canManageFleet', () => {
  it('returns true for developer and manager only', () => {
    expect(canManageFleet('developer')).toBe(true);
    expect(canManageFleet('manager')).toBe(true);
  });

  it('returns false for mechanic and operator', () => {
    expect(canManageFleet('mechanic')).toBe(false);
    expect(canManageFleet('operator')).toBe(false);
  });
});
