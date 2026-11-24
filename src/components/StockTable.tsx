'use client'
import { card } from '@/components/ui'

export default function StockTable({ rows }: { rows: any[] }) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="py-1">Item</th>
            <th>Type</th>
            <th className="text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className="border-t">
              <td className="py-1.5">{r.name}</td>
              <td className="text-neutral-500">{r.kind.toLowerCase()}</td>
              <td className="text-right font-medium">
                {r.displayQty} {r.displayUnit}
                {r.low && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-700">low</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

