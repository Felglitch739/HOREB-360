export const COMBO_PRICE_CENTS = 7000; // $70.00 MXN en centavos enteros

export function formatMxn(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safeCents < 0 ? '-' : '';
  const abs = Math.abs(safeCents);
  const pesos = Math.floor(abs / 100);
  const remCents = abs % 100;
  return `${sign}$${pesos.toLocaleString('es-MX')}.${String(remCents).padStart(2, '0')}`;
}

export function formatMxnCurrency(cents: number): string {
  return `${formatMxn(cents)} MXN`;
}

/**
 * Convierte una cadena en pesos MXN (ej. "70", "30.50", "$40") a centavos enteros.
 * Devuelve null si no es un importe válido no negativo.
 */
export function parsePesosToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$\s*/, '');
  const normalized = /^\d+,\d{1,2}$/.test(cleaned)
    ? cleaned.replace(',', '.')
    : cleaned.replace(/^(\d{1,3}(?:,\d{3})+)(?=\.|$)/, (grouped) => grouped.replaceAll(',', ''));
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [wholePart, fracPart = ''] = normalized.split('.');
  const pesos = Number.parseInt(wholePart, 10);
  const cents = Number.parseInt(fracPart.padEnd(2, '0'), 10);
  const total = pesos * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

export function calculateTender(totalCents: number, cashInput: string, cardInput: string, transferInput: string) {
  const [cash, card, transfer] = [cashInput, cardInput, transferInput].map((value) =>
    value.trim() === '' ? 0 : parsePesosToCents(value),
  );
  if (cash === null || card === null || transfer === null) {
    return { ok: false, error: 'Revisa los importes. Los campos vacíos cuentan como $0.00.' } as const;
  }
  const external = card + transfer;
  if (external > totalCents || (external === totalCents && cash > 0)) {
    return { ok: false, error: 'La tarjeta y la transferencia ya cubren el total. Revisa los importes.' } as const;
  }
  const cashDue = totalCents - external;
  const cashApplied = Math.min(cash, cashDue);
  return { ok: true, cash, cashApplied, card, transfer, change: cash - cashApplied, remaining: cashDue - cashApplied } as const;
}
