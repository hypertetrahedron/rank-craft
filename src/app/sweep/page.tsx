import dynamic from 'next/dynamic'

const SweepView = dynamic(() => import('@/components/SweepView').then((m) => m.SweepView), {
  ssr: false,
  loading: () => <p className="text-sm text-ink-muted">Loading…</p>,
})

export default function SweepPage() {
  return <SweepView />
}
