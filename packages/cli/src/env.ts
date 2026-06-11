/**
 * Must be imported before anything that (transitively) imports React.
 *
 * React and react-reconciler pick their dev/prod build by reading NODE_ENV at
 * require time. The development build emits a performance.measure() entry for
 * EVERY component render (Component Performance Tracks for Chrome DevTools)
 * and the buffer is never drained: in a TUI that re-renders on every streamed
 * token this accumulates millions of PerformanceMeasure objects — gigabytes
 * of heap in minutes. Default to production; export NODE_ENV=development to
 * opt back into the dev build.
 */
process.env.NODE_ENV ??= "production";

// Safety valve for explicit dev runs: the dev reconciler still fills the
// performance buffer, so drain it periodically. This trades away DevTools
// timeline history older than 30s for a bounded heap on long sessions.
if (process.env.NODE_ENV !== "production") {
  const timer = setInterval(() => {
    performance.clearMeasures();
    performance.clearMarks();
  }, 30_000);
  timer.unref?.();
}
