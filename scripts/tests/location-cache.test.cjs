const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the service with native GPS/storage replaced; no device or network required.
function loadService(storage = new Map(), overrides = {}) {
  const actions = [];
  let gpsCalls = 0;
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../services/locationCacheService.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const context = {
    exports: {}, process: { env: {} }, console, AbortController,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    require: name => {
      if (name.includes('async-storage')) return {
        getItem: async key => storage.get(key) || null,
        setItem: async (key, value) => { storage.set(key, value); },
      };
      if (name === 'expo-location') return {
        Accuracy: { Balanced: 3 },
        getForegroundPermissionsAsync: async () => ({ status: 'granted' }),
        getCurrentPositionAsync: async () => { gpsCalls++; return { coords: { latitude: 1, longitude: 2 }, timestamp: Date.now() }; },
        getLastKnownPositionAsync: async () => null,
        reverseGeocodeAsync: async () => [],
        ...overrides,
      };
      if (name.includes('locationSlice')) return {
        setLocation: payload => ({ type: 'location', payload }),
        setLocationAddress: payload => ({ type: 'address', payload }),
      };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  return { service: context.exports, actions, dispatch: action => actions.push(action), gpsCalls: () => gpsCalls };
}
const selected = { latitude: 25.35, longitude: 81.83, timestamp: Date.now(), source: 'selected', addressLine: 'Selected delivery address' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('selected delivery location survives app reload, cache expiry and foreground GPS refresh', async () => {
  const storage = new Map();
  await loadService(storage).service.saveCachedUserLocation({ ...selected, timestamp: 1 });
  const app = loadService(storage);
  const result = await app.service.warmupUserLocationCache({ forceRefresh: true, dispatch: app.dispatch });
  assert.equal(result.latitude, selected.latitude);
  assert.equal(result.source, 'selected');
  assert.equal(app.gpsCalls(), 0);
  assert.equal(app.actions.at(-1).payload.addressLine, selected.addressLine);
});

test('a pending GPS fix cannot overwrite a newly confirmed delivery location', async () => {
  const position = deferred();
  const started = deferred();
  const app = loadService(new Map(), {
    getCurrentPositionAsync: () => { started.resolve(); return position.promise; },
  });
  const refresh = app.service.warmupUserLocationCache({ forceRefresh: true, dispatch: app.dispatch });
  await started.promise;
  await app.service.saveCachedUserLocation(selected, app.dispatch);
  position.resolve({ coords: { latitude: 1, longitude: 2 }, timestamp: Date.now() });
  await refresh;
  assert.equal((await app.service.getFreshCachedUserLocation()).latitude, selected.latitude);
  assert.equal(app.actions.at(-1).payload.latitude, selected.latitude);
});

test('an old reverse-geocode response cannot rename a newly selected address', async () => {
  const address = deferred();
  const started = deferred();
  const app = loadService(new Map(), {
    reverseGeocodeAsync: () => { started.resolve(); return address.promise; },
  });
  await app.service.saveCachedUserLocation({ latitude: 1, longitude: 2, timestamp: Date.now() });
  const hydrate = app.service.hydrateCachedLocationAddress({ dispatch: app.dispatch });
  await started.promise;
  await app.service.saveCachedUserLocation(selected, app.dispatch);
  address.resolve([{ name: 'Old GPS address' }]);
  await hydrate;
  assert.equal((await app.service.getFreshCachedUserLocation()).addressLine, selected.addressLine);
  assert.equal(app.actions.at(-1).payload.addressLine, selected.addressLine);
});
