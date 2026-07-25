/**
 * Registry for fire-and-forget async work: `procesarEnvioSRI` (all 5
 * document services), the usage-metering hooks it and the CRUD create
 * routes call (`recordEmission`/`recordSriOutcome` in usage.service.ts),
 * and `apiKeyAuth`'s `touchLastUsed` — none of these are ever awaited by
 * their caller, by design (the request/response cycle must not wait on
 * bookkeeping or the SRI round trip). `src/utils/scheduledCheck.utils.ts`
 * covers the *timer* half of this (the ~5s retry `programarConsultaAutorizacion`
 * schedules); this covers the *promise* half — the async work that starts
 * running the moment the call is made, with nothing in the request cycle
 * (or a test) ever naturally waiting for it to settle.
 *
 * In a real server that's fine — it's the intended behavior. In tests, if a
 * test's request reaches one of these call sites, the underlying promise
 * can still be executing after that test's own assertions have run and the
 * test has returned: it keeps making calls against whatever jest mocks are
 * active at the moment it happens to resume, which — because the *next*
 * test's `beforeEach` has often already reconfigured those same mocks by
 * then — can corrupt that next, unrelated test's call counts/arguments
 * instead of its own.
 *
 * Every promise created at one of these call sites is registered here via
 * `trackBackgroundWork`. `flushAllBackgroundWork` — awaited from
 * `__tests__/setup.ts`'s global `afterEach`, before mocks are reset for the
 * next test — waits for every currently-pending one to settle first, so
 * none can ever run during a later, unrelated test. This doesn't change any
 * of these functions' fire-and-forget *behavior* in production (the promise
 * is still created and still never awaited by its real caller); it only
 * gives the test suite a way to drain them between tests.
 */
const pendingWork = new Set<Promise<unknown>>();

export const trackBackgroundWork = (work: Promise<unknown>): void => {
  pendingWork.add(work);
  const forget = (): void => {
    pendingWork.delete(work);
  };
  work.then(forget, forget);
};

/**
 * Test-only escape hatch: waits for every currently-tracked fire-and-forget
 * promise to settle (each already handles its own errors, so this never
 * rejects) and forgets about them. Not used by production code.
 */
export const flushAllBackgroundWork = async (): Promise<void> => {
  await Promise.allSettled([...pendingWork]);
};
