const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../utils/trackingRoute.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const start = { latitude: 25.4, longitude: 81.8 }, end = { latitude: 25.45, longitude: 81.85 };
function load(fetch, key = '', timers = {}) {
  const context = { exports: {}, process: { env: { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: key } }, fetch, AbortController, setTimeout, clearTimeout, ...timers };
  vm.runInNewContext(code, context);
  return context.exports.fetchDrivingRoute;
}
test('uses road geometry and duration from the fallback provider', async () => {
  const route = await load(async () => ({ ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[81.8,25.4],[81.82,25.42],[81.85,25.45]] }, duration: 120, distance: 1000 }] }) }))(start,end);
  assert.equal(route.points.length,3); assert.equal(route.durationSec,120); assert.equal(route.points[0].latitude,25.4);
});
test('provider errors keep endpoint preview without fabricating ETA', async () => {
  const route = await load(async () => { throw new Error('offline'); }, 'test')(start,end);
  assert.equal(JSON.stringify(route.points),JSON.stringify([start,end])); assert.equal(route.durationSec,0);
});
test('invalid provider coordinates cannot corrupt the map', async () => {
  const route = await load(async () => ({ ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[null,null],[900,900]] } }] }) }))(start,end);
  assert.equal(JSON.stringify(route.points),JSON.stringify([start,end]));
});
test('stalled requests time out and fall back instead of leaving route blank', async () => {
  let aborted = 0;
  const route = await load((_url, { signal }) => new Promise((_resolve,reject) => {
    signal.addEventListener('abort', () => { aborted++; reject(new Error('aborted')); });
  }), 'test', { setTimeout: fn => setTimeout(fn,5) })(start,end);
  assert.equal(aborted,2); assert.equal(route.points.length,2); assert.equal(route.durationSec,0);
});
