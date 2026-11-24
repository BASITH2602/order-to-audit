/** Shared (client + server) report types, catalog and money formatting. No server imports here. */

export type ColKind = 'text' | 'date' | 'int' | 'money' | 'qty' | 'pct'
export type Col = { key: string; label: string; kind: ColKind }
export type Cell = string | number | null
export type Row = Record<string, Cell>
export type Report = { name: string; title: string; subtitle: string; columns: Col[]; rows: Row[]; totals?: Row }

export const REPORTS = [
  { name: 'sales-register', title: 'Sales register', needsItem: false },
  { name: 'sales-by-customer', title: 'Customer-wise sales', needsItem: false },
  { name: 'sales-by-product', title: 'Product-wise sales', needsItem: false },
  { name: 'gst-summary', title: 'GST summary of outward supplies (GSTR-1 / 3B)', needsItem: false },
  { name: 'gst-hsn', title: 'HSN summary of outward supplies', needsItem: false },
  { name: 'purchase-register', title: 'Purchase register', needsItem: false },
  { name: 'stock-summary', title: 'Stock summary', needsItem: false },
  { name: 'stock-ledger', title: 'Stock ledger', needsItem: true },
  { name: 'production', title: 'Production: planned vs actual, yield, wastage', needsItem: false },
  { name: 'costing', title: 'Cost per packet by production run', needsItem: false },
  { name: 'collections', title: 'Payments and collections', needsItem: false },
  { name: 'ageing', title: 'Outstanding receivables with ageing', needsItem: false },
] as const

/** Integer paise -> "7,875.00" (grouped, Indian style) or "7875.00". Exact: integer arithmetic only. */
export function moneyStr(p: number, group = false): string {
  const neg = p < 0
  const a = Math.abs(Math.round(p))
  const whole = Math.floor(a / 100)
  return `${neg ? '-' : ''}${group ? whole.toLocaleString('en-IN') : String(whole)}.${String(a % 100).padStart(2, '0')}`
}
