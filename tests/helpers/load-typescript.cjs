const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');

function loadTypescript(filename, mocks = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const originalRequire = createRequire(filename);
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: name => (name in mocks ? mocks[name] : originalRequire(name)),
      process,
      console,
      URL,
      __dirname: require('node:path').dirname(filename),
      ...globals,
    },
    { filename }
  );
  return module.exports;
}
module.exports = { loadTypescript };
