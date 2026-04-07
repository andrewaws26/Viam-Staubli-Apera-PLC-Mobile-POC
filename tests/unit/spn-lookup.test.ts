import { lookupSPN, lookupFMI } from '../../src/utils/spn-lookup';

describe('lookupSPN', () => {
  it('returns known SPN info', () => {
    const info = lookupSPN(190);
    expect(info.name).toBe('Engine Speed');
    expect(info.severity).toBe('critical');
  });

  it('returns coolant temp SPN', () => {
    const info = lookupSPN(110);
    expect(info.name).toBe('Engine Coolant Temperature');
    expect(info.severity).toBe('critical');
  });

  it('returns aftertreatment SPN', () => {
    const info = lookupSPN(3226);
    expect(info.name).toContain('DEF');
    expect(info.severity).toBe('warning');
  });

  it('returns fallback for unknown SPN', () => {
    const info = lookupSPN(99999);
    expect(info.name).toBe('SPN 99999');
    expect(info.severity).toBe('warning');
  });
});

describe('lookupFMI', () => {
  it('returns known FMI description', () => {
    expect(lookupFMI(0)).toBe('Data valid but above normal range');
    expect(lookupFMI(3)).toBe('Voltage above normal or shorted high');
    expect(lookupFMI(4)).toBe('Voltage below normal or shorted low');
    expect(lookupFMI(31)).toBe('Condition exists');
  });

  it('returns fallback for unknown FMI', () => {
    expect(lookupFMI(99)).toBe('Unknown failure mode 99');
  });
});
