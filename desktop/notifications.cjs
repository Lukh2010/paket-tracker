// Pure change detection, shared by the tray app and regression tests.
function collectChanges(shipments, state, options = {}) {
  const next = { ...state };
  const changes = [];
  for (const shipment of shipments || []) {
    const event = shipment.event;
    if (shipment.error || !shipment.checkedAt || !event) continue;
    const keys = [...new Set([shipment.id, ...(shipment.numbers || [])])];
    const previous = keys.map((key) => state[key]).filter(Boolean);
    const fingerprint = JSON.stringify([
      event.code,
      event.description,
      shipment.status,
    ]);
    const seen = [...new Set(previous.flatMap((p) => p.seen || []))];
    const lastTime = Math.max(0, ...previous.map((p) => p.time || 0));
    const eventTime = ['ORDER_PROCESSING', 'WAITING_FOR_DELIVERY'].includes(
      event.code,
    )
      ? 0
      : Number(event.time) || 0;
    const changed =
      previous.length > 0 &&
      !seen.includes(fingerprint) &&
      eventTime >= lastTime;
    const entry = {
      seen: [...new Set([...seen, fingerprint])].slice(-100),
      time: Math.max(lastTime, eventTime),
    };
    keys.forEach((key) => {
      next[key] = entry;
    });
    if (
      changed &&
      !['ORDER_PROCESSING', 'WAITING_FOR_DELIVERY'].includes(event.code) &&
      options.enabled !== false &&
      !options.quiet
    )
      changes.push(shipment);
  }
  return { state: next, changes };
}
module.exports = { collectChanges };
