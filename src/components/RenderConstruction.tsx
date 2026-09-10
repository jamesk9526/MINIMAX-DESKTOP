import { LoaderCircle } from 'lucide-react'

interface RenderConstructionProps {
  state?: string
}

export function RenderConstruction({ state = 'running' }: RenderConstructionProps) {
  return <div className="construction-visual" data-state={state} aria-hidden="true">
    <div className="construction-orbit">
      <span className="construction-pulse" />
      <LoaderCircle size={20} />
    </div>
    <div className="construction-blocks">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>
  </div>
}
