// Stub for `react-devtools-core`, an optional dev-only dependency that Ink only
// imports when `process.env.DEV === 'true'`. It is never used in the shipped
// binary, so we replace it with an empty module to keep the bundle resolvable.
export default {};
