import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { buildReport, parseRange } from '@/lib/reports'
import { toCsv, toPdf, toXlsx } from '@/lib/report-export'

// GET /api/reports/:name?from=YYYY-MM-DD&to=YYYY-MM-DD&itemId=&format=json|csv|xlsx|pdf
export const GET = route(['FACTORY_ADMIN', 'ACCOUNTANT', 'OWNER'], async ({ req, params }) => {
  const q = new URL(req.url).searchParams
  const range = parseRange(q.get('from'), q.get('to'))
  const itemId = q.get('itemId') ? Number(q.get('itemId')) : undefined
  if (itemId !== undefined && !Number.isInteger(itemId)) throw new Error('itemId must be a whole number')
  const report = await buildReport(params.name, range, { itemId })
  const format = q.get('format') ?? 'json'
  if (format === 'json') return report

  const company = (await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).companyName
  const base = `${report.name}_${range.fromStr}_${range.toStr}`
  const attach = (type: string, ext: string) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${base}.${ext}"` })

  switch (format) {
    case 'csv':
      return new Response(toCsv(report), { headers: attach('text/csv; charset=utf-8', 'csv') })
    case 'xlsx':
      return new Response(new Uint8Array(await toXlsx(report, company)), { headers: attach('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx') })
    case 'pdf':
      return new Response(Buffer.from(await toPdf(report, company)), { headers: attach('application/pdf', 'pdf') })
    default:
      throw new Error('format must be json, csv, xlsx or pdf')
  }
})
