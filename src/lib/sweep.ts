import type { BuiltinFunction } from './builtins'
import type { FunctionKind, SimConfig } from './simConfig'

/**
 * Generating the list of configurations a sweep will run.
 *
 * Two shapes, one mechanism. Varying a *function* answers "which strategy is
 * better"; varying a *number* answers "what is this knob worth". Both produce a
 * list of configs that differ from the base in exactly one place, which is what
 * makes the comparison between them paired and readable.
 */

export type SweepAxis =
  | { type: 'function'; kind: FunctionKind; ids: string[] }
  | { type: 'param'; kind: FunctionKind; name: string; from: number; to: number; steps: number }
  | { type: 'field'; name: 'rounds' | 'players' | 'top_cut'; from: number; to: number; steps: number }
  | { type: 'model'; name: ModelKnob; from: number; to: number; steps: number }

export type ModelKnob =
  | 'variance.max_up'
  | 'variance.skill_coupling'
  | 'matchup.amplitude'
  | 'side.advantage'
  | 'fatigue.amplitude'
  | 'initial_rating.noise'

export const MODEL_KNOBS: { value: ModelKnob; label: string; hint: string }[] = [
  { value: 'variance.max_up', label: 'Match randomness', hint: 'How far skill can swing in a game' },
  { value: 'matchup.amplitude', label: 'Matchup swing', hint: 'How non-transitive the field is' },
  { value: 'side.advantage', label: 'Going first', hint: 'What the first turn is worth' },
  { value: 'fatigue.amplitude', label: 'Fatigue', hint: 'Skill lost per round when tired' },
  { value: 'initial_rating.noise', label: 'Seeding error', hint: 'How wrong the starting ratings are' },
  { value: 'variance.skill_coupling', label: 'Strong-player consistency', hint: '0 = everyone equally erratic' },
]

/** Evenly spaced values including both ends; a single step returns just `from`. */
export function axisValues(from: number, to: number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps))
  if (n === 1) return [from]
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1))
}

function setPath(cfg: SimConfig, path: string, value: number): SimConfig {
  const [group, key] = path.split('.') as [keyof SimConfig, string]
  const block = cfg[group] as unknown as Record<string, unknown>
  return { ...cfg, [group]: { ...block, [key]: value } }
}

export type SweepCell = { label: string; config: SimConfig }

/**
 * Expand one axis into the configurations to run. Every cell shares the base
 * seed, so the whole sweep is one paired sample and the differences between
 * cells are differences in the strategy rather than in the dice.
 */
export function expandSweep(
  base: SimConfig,
  axis: SweepAxis,
  library: Record<FunctionKind, BuiltinFunction[]>
): SweepCell[] {
  if (axis.type === 'function') {
    return axis.ids
      .map((id) => library[axis.kind].find((f) => f.id === id))
      .filter((f): f is BuiltinFunction => Boolean(f))
      .map((f) => ({
        label: f.name,
        config: {
          ...base,
          functions: {
            ...base.functions,
            [axis.kind]: {
              name: f.name,
              sourceId: f.id,
              code: f.code,
              params: Object.fromEntries(
                Object.entries(f.params).map(([k, v]) => [k, v.default])
              ),
            },
          },
        },
      }))
  }

  if (axis.type === 'param') {
    return axisValues(axis.from, axis.to, axis.steps).map((v) => ({
      label: `${axis.name} = ${fmtAxis(v)}`,
      config: {
        ...base,
        functions: {
          ...base.functions,
          [axis.kind]: {
            ...base.functions[axis.kind],
            params: { ...base.functions[axis.kind].params, [axis.name]: v },
          },
        },
      },
    }))
  }

  if (axis.type === 'field') {
    return axisValues(axis.from, axis.to, axis.steps).map((v) => ({
      label: `${axis.name} = ${Math.round(v)}`,
      config: { ...base, [axis.name]: Math.round(v) },
    }))
  }

  return axisValues(axis.from, axis.to, axis.steps).map((v) => ({
    label: `${MODEL_KNOBS.find((k) => k.value === axis.name)?.label ?? axis.name} = ${fmtAxis(v)}`,
    config: setPath(base, axis.name, v),
  }))
}

export function fmtAxis(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1)
}

/** Rough cost, so a sweep can warn before it spends ten minutes. */
export function sweepCost(cells: SweepCell[]): number {
  return cells.reduce(
    (sum, c) => sum + Math.floor(c.config.players / 2) * c.config.rounds * c.config.replications,
    0
  )
}
