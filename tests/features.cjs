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

test('Feature 2: updateParcelMeta updates name and note, persists, and finds by primary or linked number', () => {
  const p1 = parcel('3070000000000020', '00340000000000020000', 'Original Name');
  p1.note = 'Original Note';
  const { parcelStore } = require(path.join(runtime, 'store.js'));
  parcelStore.setParcelsFromClient([p1]);

  // 1. Update by primary number
  const updated1 = parcelStore.updateParcelMeta('3070000000000020', {
    name: 'Updated Name 1',
    note: 'Updated Note 1',
  });
  assert.ok(updated1);
  assert.equal(updated1.name, 'Updated Name 1');
  assert.equal(updated1.note, 'Updated Note 1');
  assert.ok(updated1.updatedAt);

  // 2. Verify file persistence in runtime parcels.json
  const persistedRaw = fs.readFileSync(path.join(runtime, 'parcels.json'), 'utf8');
  const persistedList = JSON.parse(persistedRaw);
  const foundInDisk = persistedList.find((p) => p.number === '3070000000000020');
  assert.ok(foundInDisk);
  assert.equal(foundInDisk.name, 'Updated Name 1');
  assert.equal(foundInDisk.note, 'Updated Note 1');

  // 3. Update by linked international number
  const updated2 = parcelStore.updateParcelMeta('00340000000000020000', {
    name: 'Updated Name 2',
    note: 'Updated Note 2',
  });
  assert.ok(updated2);
  assert.equal(updated2.name, 'Updated Name 2');
  assert.equal(updated2.note, 'Updated Note 2');

  // 4. Updating non-existent returns null
  assert.equal(parcelStore.updateParcelMeta('NONEXISTENT999', { name: 'Foo' }), null);
});

test('Feature 5: parseCainiaoItem parses estimatedDeliveryTime from item fields and traces, and buildAiSummary includes it', () => {
  const { parseCainiaoItem } = require(path.join(runtime, 'tracking.js'));

  // 1. From item.estimatedDeliveryTime timestamp
  const itemWithEta = {
    mailNo: '3070000000000021',
    destCountry: 'DE',
    estimatedDeliveryTime: 1792000000000,
    detailList: [],
  };
  const parsed1 = parseCainiaoItem(itemWithEta);
  assert.equal(parsed1.estimatedDeliveryTime, 1792000000000);

  // 2. From item.promiseDeliveryTime
  const itemWithPromise = {
    mailNo: '3070000000000022',
    destCountry: 'DE',
    promiseDeliveryTime: '2026-10-15',
  };
  const parsed2 = parseCainiaoItem(itemWithPromise);
  assert.equal(parsed2.estimatedDeliveryTime, '2026-10-15');

  // 3. From item.estimatedDeliveryTimeDesc
  const itemWithDesc = {
    mailNo: '3070000000000023',
    destCountry: 'DE',
    estimatedDeliveryTimeDesc: 'Estimated delivery: 12. Okt',
  };
  const parsed3 = parseCainiaoItem(itemWithDesc);
  assert.equal(parsed3.estimatedDeliveryTime, 'Estimated delivery: 12. Okt');

  // 4. From trace description match
  const itemWithTraceEta = {
    mailNo: '3070000000000024',
    destCountry: 'DE',
    detailList: [
      {
        desc: 'Voraussichtliche Zustellung: 14. Okt',
        actionCode: 'GTMS_DELIVERING',
        time: 1000,
      },
    ],
  };
  const parsed4 = parseCainiaoItem(itemWithTraceEta);
  assert.equal(parsed4.estimatedDeliveryTime, '14. Okt');

  // 5. Check buildAiSummary
  const pWithEta = parcel('3070000000000021', undefined, 'ETA Paket');
  pWithEta.data.estimatedDeliveryTime = '12. Okt';
  const summary = buildAiSummary([pWithEta]);
  assert.equal(summary.items[0].estimatedDeliveryTime, '12. Okt');
  assert.equal(summary.shipments[0].estimatedDeliveryTime, '12. Okt');
  assert.ok(summary.markdownSummary.includes('Voraussichtliche Lieferung: 12. Okt'));
});

test('Feature 8: carrierTracking detects DHL, DPD, Hermes, GLS, UPS, preserves AP exclusion, and detects DHL handover', () => {
  // 1. UPS (1Z...)
  const ups = carrierTracking('1Z9999999999999999');
  assert.ok(ups);
  assert.equal(ups.name, 'UPS');
  assert.equal(ups.inferred, true);
  assert.ok(ups.url.includes('tracknum=1Z9999999999999999'));

  // 2. DPD (14 digits)
  const dpdDirect = carrierTracking('01234567890123');
  assert.ok(dpdDirect);
  assert.equal(dpdDirect.name, 'DPD');
  assert.equal(dpdDirect.inferred, true);
  assert.ok(dpdDirect.url.includes('shipment/01234567890123'));

  // 3. Hermes (16 digits and H10)
  const hermes16 = carrierTracking('1234567890123456');
  assert.ok(hermes16);
  assert.equal(hermes16.name, 'Hermes');
  assert.ok(hermes16.url.includes('sendungsdetails#1234567890123456'));

  const hermesH10 = carrierTracking('H1012345678901234567');
  assert.ok(hermesH10);
  assert.equal(hermesH10.name, 'Hermes');

  // 4. GLS (11 digits)
  const gls = carrierTracking('12345678901');
  assert.ok(gls);
  assert.equal(gls.name, 'GLS');
  assert.ok(gls.url.includes('match=12345678901'));

  // 5. DHL (0034... and domestic 12 digits)
  const dhl0034 = carrierTracking('00341234567890123456');
  assert.ok(dhl0034);
  assert.equal(dhl0034.name, 'DHL');
  assert.ok(dhl0034.url.includes('piececode=00341234567890123456'));

  const dhl12 = carrierTracking('123456789012');
  assert.ok(dhl12);
  assert.equal(dhl12.name, 'DHL');

  // 6. Negative exclusion preserved: AP123456789, LP..., CN...
  assert.equal(carrierTracking('AP123456789'), null);
  assert.equal(carrierTracking('LP00123456789012'), null);
  assert.equal(carrierTracking('3070000000000014'), null);

  // 7. Automatic DHL handover for German Cainiao shipments
  const { parseCainiaoItem } = require(path.join(runtime, 'tracking.js'));
  const cainiaoHandover = parseCainiaoItem({
    mailNo: '3070000000000030',
    destCountry: 'Deutschland',
    copyRealMailNo: '00340000000000030000',
    detailList: [
      {
        desc: 'Am Transportknoten angekommen - An DHL übergeben: 00340000000000030000',
        actionCode: 'LH_HO_IN_SUCCESS',
        time: 2000,
      },
    ],
  });
  assert.equal(cainiaoHandover.carrier, 'DHL');
  assert.equal(cainiaoHandover.internationalNumber, '00340000000000030000');

  const handoverParcel = {
    number: '3070000000000030',
    name: 'Handover Test',
    note: '',
    data: cainiaoHandover,
  };
  const dhlInfo = carrierTracking(handoverParcel);
  assert.ok(dhlInfo);
  assert.equal(dhlInfo.name, 'DHL');
  assert.equal(dhlInfo.number, '00340000000000030000');
});

test('Feature 8: store.add creates direct carrier tracking when Cainiao fails for recognized domestic carriers', async () => {
  const { parcelStore } = require(path.join(runtime, 'store.js'));
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      throw new Error('Noch keine Trackingdaten bei Cainiao hinterlegt.');
    };

    // Adding UPS parcel directly
    const upsParcel = await parcelStore.add({
      number: '1Z12345E0205271688',
      name: 'UPS Direkt',
    });
    assert.equal(upsParcel.error, undefined);
    assert.ok(upsParcel.data);
    assert.equal(upsParcel.data.carrier, 'UPS');
    assert.equal(upsParcel.data.status, 'ORDER_PROCESSING');
    const upsLink = carrierTracking(upsParcel);
    assert.ok(upsLink);
    assert.equal(upsLink.name, 'UPS');

    // Adding DHL parcel directly
    const dhlParcel = await parcelStore.add({
      number: '00340434161094015848',
      name: 'DHL Direkt',
    });
    assert.equal(dhlParcel.error, undefined);
    assert.ok(dhlParcel.data);
    assert.equal(dhlParcel.data.carrier, 'DHL');
    const dhlLink = carrierTracking(dhlParcel);
    assert.ok(dhlLink);
    assert.equal(dhlLink.name, 'DHL');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Bug 3 & 4: number halving removed and duplicate check rejects primary and linked numbers', async () => {
  const { parcelStore } = require(path.join(runtime, 'store.js'));
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      throw new Error('offline');
    };

    // Bug 3: A number with repeating halves is NOT halved
    // e.g. 1234567812345678
    const repeatingNum = '1234567812345678';
    const added = await parcelStore.add({
      number: repeatingNum,
      name: 'Repeating Half Test',
    });
    assert.equal(added.number, repeatingNum);

    // Bug 4: Attempting to add the exact same number throws duplicate error
    await assert.rejects(
      async () => {
        await parcelStore.add({
          number: repeatingNum,
          name: 'Duplicate Test',
        });
      },
      {
        message: 'Sendung ist bereits vorhanden.',
      },
    );

    // Bug 4: Attempting to add by linked/international number also throws duplicate error
    const primaryNum = '3079999999999999';
    const linkedIntNum = '00349999999999999999';
    parcelStore.setParcelsFromClient([
      parcel(primaryNum, linkedIntNum, 'Primary Parcel'),
    ]);

    await assert.rejects(
      async () => {
        await parcelStore.add({
          number: linkedIntNum,
          name: 'Linked Duplicate Test',
        });
      },
      {
        message: 'Sendung ist bereits vorhanden.',
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

