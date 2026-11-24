import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { variancePct, isFlagged } from '@/lib/costing'
import { getRunCosting, setRunOverheads } from '@/lib/stock'

export const GET = route(['PRODUCTION', 'FACTORY_ADMIN', 'OWNER', 'ACCOUNTANT'], async ({ params }) => {
  const id = Number(params.id)
  const settings = await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })
  const run = await prisma.productionRun.findUniqueOrThrow({
    where: { id },
    include: { lines: { include: { item: true } }, bom: { include: { product: true } } },
  })
  const lines = run.lines.map((l) => {
    const pct = variancePct(l.plannedQty, l.actualQty)
    return { ...l, variancePct: pct, flagged: isFlagged(pct, settings.variancePctTol) }
  })
  const yPct = variancePct(run.expectedOutput, run.goodOutput)
  return {
    run,
    lines,
    yield: { expected: run.expectedOutput, actual: run.goodOutput, variancePct: yPct, flagged: isFlagged(yPct, settings.variancePctTol) },
    costing: await getRunCosting(id),
  }
})

// Add labour / power-gas / other overheads after the run. Audit-logged.
export const PATCH = route(['FACTORY_ADMIN', 'PRODUCTION'], async ({ session, req, params }) => {
  const o = z
    .object({
      labourPaise: z.number().int().nonnegative().optional(),
      powerGasPaise: z.number().int().nonnegative().optional(),
      otherOverheadPaise: z.number().int().nonnegative().optional(),
    })
    .parse(await req.json())
  await setRunOverheads(Number(params.id), o, session.userId)
  return getRunCosting(Number(params.id))
})
