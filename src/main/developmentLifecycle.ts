// Forge can exit without terminating its Electron child. Observe the launcher as
// well as signals so closing the terminal (or killing only the launcher) is covered.
export function installDevelopmentShutdown(quit: () => void, { parentPid = process.ppid, pollInterval = 1000 } = {}) {
  let stopped = false;
  const shutdown = () => {
    if (stopped) return;
    dispose();
    quit();
  };
  const checkParent = () => {
    if (parentPid <= 1 || process.ppid !== parentPid) {
      shutdown();
      return;
    }
    try {
      process.kill(parentPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') shutdown();
    }
  };
  const timer = setInterval(checkParent, pollInterval);
  timer.unref();
  function dispose() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('exit', dispose);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.once('exit', dispose);
  return dispose;
}
