/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'unterwegs-test-'));
process.on('exit', () => fs.rmSync(runtime, { recursive: true, force: true }));
for (const name of ['tracking', 'shipments', 'store']) {
  let source = fs.readFileSync(
    path.join(__dirname, '..', 'lib', name + '.ts'),
    'utf8',
  );
  if (name === 'store')
    source = source.replace(
      "path.resolve(process.env.UNTERWEGS_DATA_DIR || 'data')",
      JSON.stringify(runtime),
    );
  fs.writeFileSync(
    path.join(runtime, name + '.js'),
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
  );
}
const { groupParcels, carrierTracking, trackingQueryNumber } = require(
  path.join(runtime, 'shipments.js'),
);
const { buildAiSummary } = require(path.join(runtime, 'tracking.js'));
const { collectChanges } = require('../desktop/notifications.cjs');
const checkedAt = '2026-09-29T06:00:00.000Z';
function parcel(number, internationalNumber, name = number) {
  return {
    number,
    name,
    note: '',
    data: {
      number,
      internationalNumber,
      checkedAt,
      carrier: 'Cainiao',
      origin: 'China',
      destination: 'Germany',
      status: 'DELIVERING',
      events: [{ code: 'LH_DEPART', description: 'Departed', time: 1000 }],
    },
  };
}
test('shared tracking numbers yield one shipment, with all original articles preserved', () => {
  const list = [
    parcel('ORDER00001', 'AP123456789'),
    parcel('ORDER00002', 'AP123456789'),
    parcel('AP123456789', undefined),
    parcel('ORDER00003', 'CN123456789'),
  ];
  const groups = groupParcels(list);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 3);
  assert.equal(list.length, 4);
  const summary = buildAiSummary(list);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.articleCount, 4);
  assert.equal(summary.items.length, 4);
  assert.equal(summary.shipments.length, 2);
  assert.ok(!summary.markdownSummary.includes('_Stand:'));
});
test('errors remain visible alongside the last successful check', () => {
  const p = parcel('ORDER00001', 'AP123456789');
  p.error = 'offline';
  const summary = buildAiSummary([p]);
  assert.ok(summary.markdownSummary.includes('offline'));
  assert.equal(summary.items[0].checkedAt, checkedAt);
});
test('carrier links use the actual tracking number and do not invent a carrier', () => {
  const dhl = carrierTracking(
    parcel('3070000000000014', '00340000000000010000'),
  );
  assert.equal(dhl.name, 'DHL');
  assert.equal(dhl.inferred, true);
  assert.ok(dhl.url.endsWith('piececode=00340000000000010000'));
  assert.equal(
    carrierTracking(parcel('3070000000000014', 'AP123456789')),
    null,
  );
  const dpd = parcel('ORDER00001', '00000000000006');
  dpd.data.carrier = 'DPD';
  assert.equal(carrierTracking(dpd).name, 'DPD');
});
function shipment(code = 'LH_DEPART', time = 1000) {
  return {
    id: 'AP123456789',
    numbers: ['ORDER00001', 'ORDER00002'],
    name: 'Gemeinsames Paket',
    checkedAt,
    status: code,
    event: { code, description: code, time },
  };
}
test('notifications baseline silently, group once, and survive restart without duplicates', () => {
  const initial = collectChanges([shipment()], {});
  assert.equal(initial.changes.length, 0);
  const next = collectChanges([shipment('LH_ARRIVE', 2000)], initial.state);
  assert.equal(next.changes.length, 1);
  assert.equal(
    collectChanges(
      [shipment('LH_ARRIVE', 2000)],
      JSON.parse(JSON.stringify(next.state)),
    ).changes.length,
    0,
  );
  assert.equal(
    collectChanges([shipment('LH_ARRIVE', 3000)], next.state).changes.length,
    0,
  );
  assert.equal(
    collectChanges([shipment('OLDER', 500)], next.state).changes.length,
    0,
  );
});
test('quiet hours, disabled notifications and failed refreshes do not notify', () => {
  const initial = collectChanges([shipment()], {}).state;
  assert.equal(
    collectChanges([shipment('LH_ARRIVE', 2000)], initial, { quiet: true })
      .changes.length,
    0,
  );
  assert.equal(
    collectChanges([shipment('LH_ARRIVE', 2000)], initial, { enabled: false })
      .changes.length,
    0,
  );
  assert.equal(
    collectChanges(
      [{ ...shipment('LH_ARRIVE', 2000), error: 'offline' }],
      initial,
    ).changes.length,
    0,
  );
  const remapped = { ...shipment('LH_ARRIVE', 2000), id: 'NEWNUMBER' };
  assert.equal(collectChanges([remapped], initial).changes.length, 1);
});
test('refresh failures keep data and time, report missing results, and retry the whole shipment', async () => {
  const a = parcel('3070000000000015', 'AP123456789');
  const b = parcel('3070000000000016', 'AP123456789');
  fs.writeFileSync(path.join(runtime, 'parcels.json'), JSON.stringify([a, b]));
  const { parcelStore } = require(path.join(runtime, 'store.js'));
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      throw new Error('offline');
    };
    let result = await parcelStore.refresh(a.number);
    assert.equal(Object.keys(result.errors).length, 2);
    for (const p of parcelStore.getAll()) {
      assert.equal(p.data.checkedAt, checkedAt);
      assert.equal(p.error, 'offline');
      assert.ok(p.lastAttemptAt);
      assert.deepEqual(p.data.events, a.data.events);
    }
    global.fetch = async () => ({
      ok: true,
      text: async () => JSON.stringify({ success: true, module: [] }),
    });
    result = await parcelStore.refresh();
    assert.equal(Object.keys(result.errors).length, 2);
    let calls = 0;
    global.fetch = async (url) => {
      calls++;
      assert.equal(new URL(url).searchParams.get('mailNos'), 'AP123456789');
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            module: [
              {
                mailNo: 'AP123456789',
                status: 'DELIVERING',
                detailList: [
                  { time: 2000, actionCode: 'LH_ARRIVE', desc: 'Arrived' },
                ],
              },
            ],
          }),
      };
    };
    result = await parcelStore.refresh(a.number);
    assert.equal(calls, 1);
    assert.equal(result.updated, 2);
    assert.deepEqual(result.errors, {});
    for (const p of parcelStore.getAll()) {
      assert.equal(p.error, undefined);
      assert.notEqual(p.data.checkedAt, checkedAt);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('first shipping event after order processing is a real notification', () => {
  const initial = collectChanges([shipment('ORDER_PROCESSING', 5000)], {});
  assert.equal(initial.changes.length, 0);
  assert.equal(
    collectChanges([shipment('LH_DEPART', 2000)], initial.state).changes.length,
    1,
  );
});

test('tracking number changes preserve grouping in both input orders', () => {
  const a = parcel('ORDER00001', 'NEW000001');
  a.data.previousNumbers = ['OLD000001'];
  const b = parcel('ORDER00002', 'OLD000001');
  assert.equal(groupParcels([a, b]).length, 1);
  assert.equal(groupParcels([b, a]).length, 1);
});

test('provider queries retain the working Cainiao number after carrier handover', () => {
  const p = parcel('3070000000000015', 'NEW000001');
  p.data.previousNumbers = ['3070000000000015', 'AP123456789'];
  assert.equal(trackingQueryNumber(p), 'AP123456789');
});
