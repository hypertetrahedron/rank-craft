import dynamic from 'next/dynamic'

// The wizard owns a Pyodide worker pool and a persisted store, neither of which
// has a meaningful server rendering.
const Wizard = dynamic(() => import('@/components/wizard/Wizard').then((m) => m.Wizard), {
  ssr: false,
  loading: () => <p className="text-sm text-ink-muted">Loading…</p>,
})

export default function HomePage() {
  return <Wizard />
}
