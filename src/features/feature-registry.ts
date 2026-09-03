/**
 * Welke features schakelbaar zijn per tenant (platformbeheer-entitlements).
 *
 * Vaste lijst in de code, aan/uit-status in de database (`clm.tenant_feature`).
 * Een `feature_key` zonder bijbehorende code is hierdoor onmogelijk — zie
 * docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md §3.
 *
 * Een nieuwe schakelbare feature: één regel toevoegen aan `FEATURE_KEYS`.
 */
export const FEATURE_KEYS = ['contractmodule'] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(waarde: unknown): waarde is FeatureKey {
  return (
    typeof waarde === 'string' &&
    (FEATURE_KEYS as readonly string[]).includes(waarde)
  );
}
