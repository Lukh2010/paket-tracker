/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
exports.run = async (base, dataDir, restart) => {
  const get = async () => (await fetch(base + '/api/parcels')).json();
  const initial = await get();
  if (restart) {
    assert.equal(initial.parcels.length, 1);
    assert.equal(initial.parcels[0].number, 'SMOKETEST001');
    const removed = await fetch(base + '/api/parcels?number=SMOKETEST001', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'parcels.json'), 'utf8')), []);
  } else {
    assert.deepEqual(initial.parcels, []);
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const html = await page.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/[^" ]+\.(?:js|css))"/g)].map((m) => m[1]);
    assert.ok(assets.length > 0, 'Built HTML references local JavaScript/CSS');
    for (const asset of new Set(assets)) assert.equal((await fetch(base + asset)).status, 200, asset);
    const saved = await fetch(base + '/api/parcels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncParcels: [{ number: 'SMOKETEST001', name: 'Installationstest', data: { number: 'SMOKETEST001', status: 'ORDER_PROCESSING', events: [], checkedAt: '' } }] }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await get()).parcels[0].number, 'SMOKETEST001');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'parcels.json'), 'utf8'))[0].number, 'SMOKETEST001');
  }
  console.log('[Smoke] Packaged server, assets and persistence verified' + (restart ? ' after restart' : ''));
};
