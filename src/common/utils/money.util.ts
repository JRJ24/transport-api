export function roundMoney(amount: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

export function formatCurrency(
  amount: number,
  currency = 'DOP',
  locale = 'es-DO',
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount,
  );
}
