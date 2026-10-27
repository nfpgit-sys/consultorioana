const wholeARS = new Intl.NumberFormat('es-AR')

export function decimalToCents(value) {
  const [whole, fraction = ''] = String(value).split('.')
  return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2))
}

export function sumDecimalCents(values) {
  return values.reduce((sum, value) => sum + decimalToCents(value), 0n)
}

export function formatARS(cents) {
  const negative = cents < 0n
  const absolute = negative ? -cents : cents
  return `${negative ? '-' : ''}$ ${wholeARS.format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')}`
}