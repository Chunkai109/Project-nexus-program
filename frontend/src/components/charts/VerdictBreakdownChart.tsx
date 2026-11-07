import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { verdictCounts } from '@/lib/sessionStats'
import type { SessionRecord } from '@/types'

/** All six AI classes for one session, sorted by count, so the bars add up to every scored rep. */
export function VerdictBreakdownChart({ session, height = 240 }: { session: SessionRecord; height?: number }) {
  const { counts, unscored } = verdictCounts(session)
  const data = Object.entries(counts)
    .map(([verdict, count]) => ({ verdict, count }))
    .sort((a, b) => b.count - a.count || a.verdict.localeCompare(b.verdict))
  const scored = data.reduce((sum, d) => sum + d.count, 0)

  return (
    <div>
      {scored === 0 ? (
        <p className="flex items-center justify-center rounded-xl bg-surface-secondary text-[13px] text-ink-faint" style={{ height }}>
          The AI hasn't scored any reps in this session yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--color-border)" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--color-border-strong)' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="verdict"
              width={84}
              tick={{ fill: 'var(--color-ink-muted)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-surface-secondary)' }}
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                fontSize: 12,
                color: 'var(--color-ink)',
              }}
              formatter={(value) => [`${value} reps`, 'AI verdict']}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.verdict} fill={d.verdict === 'Perfect' ? 'var(--color-emerald)' : 'var(--color-crimson)'} fillOpacity={d.verdict === 'Perfect' ? 0.9 : 0.75} />
              ))}
              <LabelList dataKey="count" position="right" fill="var(--color-ink-muted)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <p className="mt-3 text-[12px] text-ink-faint">
        {scored} of {session.reps.length} reps scored by the AI
        {unscored > 0 ? ` · ${unscored} with no AI verdict (camera missed the rep or the AI was offline)` : ''}
      </p>
    </div>
  )
}
