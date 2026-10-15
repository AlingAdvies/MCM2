import { FEATURE_KEYS, isFeatureKey } from './feature-registry';

describe('feature-registry', () => {
  it('bevat contractmodule als geldige feature-sleutel', () => {
    expect(FEATURE_KEYS).toContain('contractmodule');
  });

  it('bevat nis2module (ADR 0006 van docs/nis2)', () => {
    expect(isFeatureKey('nis2module')).toBe(true);
  });

  it('herkent een geldige sleutel', () => {
    expect(isFeatureKey('contractmodule')).toBe(true);
  });

  it('wijst een onbekende sleutel af', () => {
    expect(isFeatureKey('onbestaande-feature')).toBe(false);
  });

  it('wijst een niet-string af', () => {
    expect(isFeatureKey(123)).toBe(false);
    expect(isFeatureKey(undefined)).toBe(false);
  });
});
