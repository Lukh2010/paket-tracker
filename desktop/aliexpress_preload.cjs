/* eslint-disable @typescript-eslint/no-require-imports */
const { ipcRenderer } = require('electron');

// 1. Inject network hook in main world to intercept MTOP and Fetch/XHR responses
const hookScript = document.createElement('script');
hookScript.textContent = `
(function() {
  // Hook fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const clone = response.clone();
      clone.text().then(text => {
        try {
          const data = JSON.parse(text);
          window.postMessage({ type: 'UNTERWEGS_AE_INTERCEPT', data }, '*');
        } catch {}
      }).catch(() => {});
    } catch {}
    return response;
  };

  // Hook XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(...args) {
    this._url = args[1];
    return originalOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        if (this.responseText) {
          const data = JSON.parse(this.responseText);
          window.postMessage({ type: 'UNTERWEGS_AE_INTERCEPT', data }, '*');
        }
      } catch {}
    });
    return originalSend.apply(this, args);
  };
})();
`;
(document.head || document.documentElement).appendChild(hookScript);

// 2. Listen to intercepted network data
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'UNTERWEGS_AE_INTERCEPT') {
    ipcRenderer.send('aliexpress-logistics-captured', event.data.data);
  }
});

// 3. Fallback: Periodically inspect DOM for tracking numbers and timeline
function inspectDOM() {
  try {
    const url = window.location.href;
    const orderMatch = url.match(/[?&](?:tradeId|orderId)=(\\d+)/i);
    const currentOrderId = orderMatch ? orderMatch[1] : null;

    const pageText = document.body ? document.body.innerText : '';

    // Search for carrier tracking number (e.g. LP00..., 0034..., CNG..., YT...)
    const trackingMatch = pageText.match(/(?:LP\\d{14,18}|0034\\d{16}|CNG\\d{14,18}|YT\\d{16,18}|[A-Z]{2}\\d{9}[A-Z]{2})/i);
    const trackingNo = trackingMatch ? trackingMatch[0] : null;

    // Search for timeline elements or status indicators
    const items = document.querySelectorAll('[class*="timeline"], [class*="node"], [class*="track-item"], [class*="logistics-item"]');
    const scrapedEvents = [];

    items.forEach((el) => {
      const text = el.innerText ? el.innerText.trim() : '';
      if (text.length > 5 && text.length < 300) {
        scrapedEvents.push(text);
      }
    });

    if (currentOrderId && (trackingNo || scrapedEvents.length > 0)) {
      ipcRenderer.send('aliexpress-dom-scraped', {
        orderId: currentOrderId,
        trackingNo,
        eventsText: scrapedEvents.slice(0, 15),
        url,
      });
    }
  } catch {}
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(inspectDOM, 2000);
  setTimeout(inspectDOM, 5000);
});
