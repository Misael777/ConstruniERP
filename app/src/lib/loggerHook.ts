export function setupConsoleLogger(): void {
  if (typeof window === 'undefined' || !console) return;

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console)
  };

  const prefix = '[AppLogger]';

  console.log = (...args: unknown[]) => originalConsole.log(prefix, ...args);
  console.info = (...args: unknown[]) => originalConsole.info(prefix, ...args);
  console.warn = (...args: unknown[]) => originalConsole.warn(prefix, ...args);
  console.error = (...args: unknown[]) => originalConsole.error(prefix, ...args);
  console.debug = (...args: unknown[]) => originalConsole.debug(prefix, ...args);
}
