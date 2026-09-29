// `process` for code bundled from Node packages.
export const process = {
  env: { LIB: 'true', NODE_ENV: 'production' },
  browser: true,
  version: '',
  versions: {},
  platform: 'browser',
  cwd: () => '/',
  on() {},
  emit() {},
  nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
}
