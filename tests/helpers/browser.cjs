function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function installBrowser(storage = createStorage()) {
  const classes = new Set();
  global.localStorage = storage;
  global.document = {
    documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } },
  };
  global.window = { localStorage: storage, matchMedia: () => ({ matches: false }) };
  return { storage, classes };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

module.exports = { createStorage, installBrowser, deferred };
