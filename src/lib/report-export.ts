/** CSV, Excel and PDF renderers for any Report. */
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { moneyStr, type Cell, type Col, type Report } from './report-catalog'

const numericKind = (k: Col['kind']) => k === 'money' || k === 'int' || k === 'qty' || k === 'pct'

// ---------- CSV ----------
function csvCell(kind: Col['kind'], v: Cell | undefined): string {
  if (v === null || v === undefined) return ''
  let s = kind === 'money' ? moneyStr(Number(v)) : String(v)
  // Spreadsheet formula injection guard for free-text columns.
  if ((kind === 'text' || kind === 'date') && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rep: Report): string {
  const lines = [rep.columns.map((c) => csvCell('text', c.label)).join(',')]
  for (const r of rep.rows) lines.push(rep.columns.map((c) => csvCell(c.kind, r[c.key])).join(','))
  if (rep.totals) lines.push(rep.columns.map((c) => csvCell(c.kind, rep.totals![c.key])).join(','))
  return '\uFEFF' + lines.join('\r\n') + '\r\n' // BOM so Excel reads UTF-8
}

// ---------- Excel ----------
export async function toXlsx(rep: Report, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(rep.name.slice(0, 31))
  ws.addRow([company]).font = { bold: true, size: 13 }
  ws.addRow([`${rep.title}  |  ${rep.subtitle}`])
  ws.addRow([])
  const head = ws.addRow(rep.columns.map((c) => c.label))
  head.font = { bold: true }
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3EE' } }
  })
  const add = (r: Record<string, Cell | undefined>, bold = false) => {
    const row = ws.addRow(
      rep.columns.map((c) => {
        const v = r[c.key]
        if (v === null || v === undefined || v === '') return null
        if (c.kind === 'money') return Number(v) / 100
        if (numericKind(c.kind)) return Number.isFinite(Number(v)) ? Number(v) : String(v)
        return String(v)
      }),
    )
    if (bold) row.font = { bold: true }
    rep.columns.forEach((c, i) => {
      if (c.kind === 'money') row.getCell(i + 1).numFmt = '#,##0.00'
    })
  }
  rep.rows.forEach((r) => add(r))
  if (rep.totals) add(rep.totals, true)
  ws.columns.forEach((col, i) => {
    const longest = Math.max(rep.columns[i].label.length, ...rep.rows.slice(0, 200).map((r) => String(r[rep.columns[i].key] ?? '').length))
    col.width = Math.min(40, Math.max(10, longest + 2))
  })
  ws.views = [{ state: 'frozen', ySplit: 4 }]
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ---------- PDF (landscape A4, paginated) ----------
export async function toPdf(rep: Report, company: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 842
  const H = 595
  const margin = 28
  const usable = W - margin * 2
  const weights = rep.columns.map((c) => (c.kind === 'text' ? 2 : c.kind === 'date' ? 1.1 : 1.25))
  const total = weights.reduce((a, b) => a + b, 0)
  const widths = weights.map((w) => (w / total) * usable)
  const size = 7.5

  const fit = (s: string, w: number, f = font) => {
    let t = s
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -1)
    return t.length < s.length ? `${t.slice(0, -1)}.` : t
  }
  const cellText = (c: Col, v: Cell | undefined) => (v === null || v === undefined ? '' : c.kind === 'money' ? moneyStr(Number(v), true) : String(v))

  let page = doc.addPage([W, H])
  let y = H - margin
  const heading = () => {
    page.drawText(company, { x: margin, y, size: 11, font: bold })
    y -= 14
    page.drawText(`${rep.title}  |  ${rep.subtitle}`, { x: margin, y, size: 8.5, font })
    y -= 16
    let x = margin
    rep.columns.forEach((c, i) => {
      const t = fit(c.label, widths[i], bold)
      page.drawText(t, { x: numericKind(c.kind) ? x + widths[i] - 3 - bold.widthOfTextAtSize(t, size) : x + 3, y, size, font: bold })
      x += widths[i]
    })
    y -= 4
    page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.6, color: rgb(0.4, 0.4, 0.4) })
    y -= 11
  }
  heading()

  const drawRow = (r: Record<string, Cell | undefined>, isBold = false) => {
    if (y < margin + 14) {
      page = doc.addPage([W, H])
      y = H - margin
      heading()
    }
    let x = margin
    const f = isBold ? bold : font
    rep.columns.forEach((c, i) => {
      const t = fit(cellText(c, r[c.key]), widths[i], f)
      page.drawText(t, { x: numericKind(c.kind) ? x + widths[i] - 3 - f.widthOfTextAtSize(t, size) : x + 3, y, size, font: f })
      x += widths[i]
    })
    y -= 11
  }
  rep.rows.forEach((r) => drawRow(r))
  if (rep.totals) {
    page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: W - margin, y: y + 8 }, thickness: 0.4, color: rgb(0.5, 0.5, 0.5) })
    drawRow(rep.totals, true)
  }
  if (rep.rows.length === 0) page.drawText('No records in this period.', { x: margin, y, size: 9, font })

  const pages = doc.getPages()
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - margin - 60, y: 14, size: 7, font }))
  return doc.save()
}
