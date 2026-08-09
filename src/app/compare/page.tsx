import dynamic from 'next/dynamic'

const CompareView = dynamic(
  () => import('@/components/results/CompareView').then((m) => m.CompareView),
  { ssr: false, loading: () => <p className="text-sm text-ink-muted">Loading…</p> }
)

export default function ComparePage() {
  return <CompareView />
}
