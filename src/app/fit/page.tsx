import dynamic from 'next/dynamic'

const FitView = dynamic(() => import('@/components/FitView').then((m) => m.FitView), {
  ssr: false,
  loading: () => <p className="text-sm text-ink-muted">Loading…</p>,
})

export default function FitPage() {
  return <FitView />
}
