export type TransitionResult<S> =
  | { ok: true; state: S }
  | { ok: false; error: string; state: S };

export function invalidTransition<
  S extends { status: string },
  E extends { type: string },
>(state: S, event: E, reason?: string): TransitionResult<S> {
  const suffix = reason ? `: ${reason}` : "";
  return {
    ok: false,
    error: `Invalid transition ${state.status} -> ${event.type}${suffix}`,
    state,
  };
}
