/**
 * Registry for the real timers each document service's
 * `programarConsultaAutorizacion` schedules via `setTimeout(..., 5000)`
 * after a successful (`RECIBIDA`) SRI submission, to poll for authorization
 * a few seconds later.
 *
 * That call is fire-and-forget — `procesarEnvioSRI` is itself never awaited
 * by its caller — so nothing in the request/response cycle (or a test) ever
 * naturally waits for it to resolve. `timer.unref()` (still applied at each
 * call site) keeps a lingering timer from blocking Node's process exit, but
 * it does NOT stop the timer from firing: if the process (or, in Jest, the
 * current worker) is still alive when it elapses, its callback runs.
 *
 * In a real server that's fine — it's the intended behavior. In tests, if a
 * test that reaches the `RECIBIDA` branch doesn't itself mock
 * `programarConsultaAutorizacion` away, a real ~5s timer can survive past
 * that test's own completion and fire during a LATER, unrelated test still
 * executing in the same Jest worker (each service's unit-test suite runs
 * for several seconds), touching whatever model mocks happen to be active
 * at that moment and intermittently flaking the run.
 *
 * Every timer created by `programarConsultaAutorizacion` is registered
 * here. `clearAllScheduledAuthorizationChecks` — called from
 * `__tests__/setup.ts`'s global `afterEach` — cancels every still-pending
 * one after each test, so none can ever survive into another test. This
 * doesn't change `programarConsultaAutorizacion`'s callable behavior (it
 * still really schedules a timer, exactly as in production), so it doesn't
 * affect the existing tests that call it directly under
 * `jest.useFakeTimers()` to exercise its retry logic, nor the tests that
 * spy/mock it away to assert it *was* called.
 */
const pendingTimers = new Set<NodeJS.Timeout>();

export const registerScheduledCheck = (timer: NodeJS.Timeout): void => {
  pendingTimers.add(timer);
};

export const unregisterScheduledCheck = (timer: NodeJS.Timeout): void => {
  pendingTimers.delete(timer);
};

/**
 * Test-only escape hatch: cancels every currently-pending
 * `programarConsultaAutorizacion` retry timer across all 5 document
 * services and forgets about them. Not used by production code.
 */
export const clearAllScheduledAuthorizationChecks = (): void => {
  pendingTimers.forEach((timer) => clearTimeout(timer));
  pendingTimers.clear();
};
