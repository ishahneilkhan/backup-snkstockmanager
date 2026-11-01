export const businessTypes = ['pharmacy', 'grocery', 'restaurant'] as const;
export type BusinessType = (typeof businessTypes)[number];
export const defaultModules = (t: BusinessType): string[] =>
  t === 'pharmacy' ? ['batches', 'expiry', 'pack_units'] : t === 'grocery' ? ['batches', 'weight', 'barcode'] : ['recipes', 'waste'];
