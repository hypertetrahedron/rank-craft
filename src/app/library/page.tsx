import dynamic from 'next/dynamic'

const Library = dynamic(() => import('@/components/Library').then((m) => m.Library), {
  ssr: false,
  loading: () => <p className="text-sm text-ink-muted">Loading…</p>,
})

export default function LibraryPage() {
  return <Library />
}
