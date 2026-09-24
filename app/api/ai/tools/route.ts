export const dynamic = 'force-dynamic';

export async function GET() {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_package_summary',
        description:
          'Liefert eine kompakte Zusammenfassung aller verfolgten AliExpress/Cainiao Pakete (wie viele unterwegs sind, wie viele angekommen sind, und aktueller Status). Ideal zur direkten Antwort an den Nutzer.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_packages',
        description:
          'Gibt die detaillierte Liste aller im Tracker hinterlegten Pakete zurück inklusive Sendungsnummer, Status, Zielland, Transporteur und letztem Scan.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_package_details',
        description:
          'Ruft den vollständigen Sendungsverlauf (Timeline aller Stationen) für eine bestimmte Sendungsnummer ab.',
        parameters: {
          type: 'object',
          properties: {
            tracking_number: {
              type: 'string',
              description:
                'Die Sendungsnummer (z. B. 00340435069718576091 oder AP00844166750486)',
            },
          },
          required: ['tracking_number'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_package',
        description:
          'Fügt eine neue Sendungsnummer zur Überwachung hinzu. Ruft sofort die ersten Trackingdaten von Cainiao ab.',
        parameters: {
          type: 'object',
          properties: {
            tracking_number: {
              type: 'string',
              description: 'Die Sendungsnummer von AliExpress oder Cainiao.',
            },
            name: {
              type: 'string',
              description:
                'Bezeichnung des Pakets / Inhalts (z. B. "G3 Max Motor" oder "Lenkerteil").',
            },
            note: {
              type: 'string',
              description:
                'Optionale Bemerkung (z. B. Bestelldatum oder Händler).',
            },
          },
          required: ['tracking_number', 'name'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'remove_package',
        description:
          'Entfernt ein Paket aus dem Tracker anhand der Sendungsnummer.',
        parameters: {
          type: 'object',
          properties: {
            tracking_number: {
              type: 'string',
              description: 'Die Sendungsnummer des zu löschenden Pakets.',
            },
          },
          required: ['tracking_number'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'refresh_packages',
        description:
          'Aktualisiert die Trackingdaten aller hinterlegten Pakete live von Cainiao.',
        parameters: {
          type: 'object',
          properties: {
            tracking_number: {
              type: 'string',
              description:
                'Optional: Nur diese Sendungsnummer aktualisieren. Wenn weggelassen, werden alle Pakete aktualisiert.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'track_single_number',
        description:
          'Fragt eine beliebige Sendungsnummer ad-hoc direkt bei Cainiao ab, ohne sie im Tracker zu speichern.',
        parameters: {
          type: 'object',
          properties: {
            tracking_number: {
              type: 'string',
              description: 'Die abzufragende Sendungsnummer.',
            },
          },
          required: ['tracking_number'],
          additionalProperties: false,
        },
      },
    },
  ];

  return Response.json({
    version: '1.0.0',
    service: 'unterwegs-aliexpress-tracker',
    tools,
  });
}
