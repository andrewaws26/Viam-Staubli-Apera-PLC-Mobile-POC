import { lookupPCode } from '../../src/utils/pcode-lookup';

describe('lookupPCode', () => {
  it('returns known P-code info', () => {
    const info = lookupPCode('P0420');
    expect(info.name).toContain('Catalyst');
    expect(info.severity).toBe('warning');
  });

  it('is case-insensitive', () => {
    const upper = lookupPCode('P0300');
    const lower = lookupPCode('p0300');
    expect(upper.name).toBe(lower.name);
  });

  it('returns fallback for unknown P-code with category', () => {
    const info = lookupPCode('P0999');
    expect(info.name).toContain('P0999');
    expect(info.description).toBeTruthy();
  });

  it('returns fallback for completely unknown code', () => {
    const info = lookupPCode('P9999');
    expect(info.name).toContain('P9999');
    expect(info.severity).toBe('warning');
  });
});
