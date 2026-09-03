import { FEATURE_KEYS, isFeatureKey } from './feature-registry';

describe('feature-registry', () => {
  it('bevat contractmodule als geldige feature-sleutel', () => {
    expect(FEATURE_KEYS).toContain('contractmodule');
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
