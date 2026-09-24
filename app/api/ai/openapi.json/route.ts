export const dynamic = 'force-dynamic';

export async function GET() {
  const schema = {
    openapi: '3.1.0',
    info: {
      title: 'Unterwegs AliExpress Package Tracker API',
      description:
        'Hintergrund- und KI-Schnittstelle zur Abfrage und Verwaltung von AliExpress/Cainiao Sendungen.',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'http://localhost:4317',
        description: 'Lokaler Hintergrund-Dienst',
      },
    ],
    paths: {
      '/api/ai/summary': {
        get: {
          summary: 'Kompakte Sendungsübersicht für KI-Modelle',
          operationId: 'get_package_summary',
          responses: {
            '200': {
              description: 'Erfolgreich',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      markdownSummary: { type: 'string' },
                      totalCount: { type: 'integer' },
                      activeCount: { type: 'integer' },
                      deliveredCount: { type: 'integer' },
                      items: { type: 'array' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/ai/parcels': {
        get: {
          summary: 'Liste aller überwachten Pakete',
          operationId: 'list_packages',
          responses: {
            '200': {
              description: 'Liste aller Pakete',
            },
          },
        },
        post: {
          summary: 'Neues Paket zur Überwachung hinzufügen',
          operationId: 'add_package',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['number', 'name'],
                  properties: {
                    number: { type: 'string', description: 'Sendungsnummer' },
                    name: { type: 'string', description: 'Name oder Inhalt' },
                    note: { type: 'string', description: 'Optionale Notiz' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Paket hinzugefügt' },
          },
        },
        delete: {
          summary: 'Paket aus der Überwachung entfernen',
          operationId: 'remove_package',
          parameters: [
            {
              name: 'number',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Paket entfernt' },
          },
        },
      },
      '/api/parcels/refresh': {
        post: {
          summary: 'Tracking-Status aller Pakete von Cainiao aktualisieren',
          operationId: 'refresh_packages',
          responses: {
            '200': { description: 'Aktualisierung abgeschlossen' },
          },
        },
      },
      '/api/track': {
        get: {
          summary: 'Einzelne Sendungsnummer ad-hoc bei Cainiao abfragen',
          operationId: 'track_single_number',
          parameters: [
            {
              name: 'number',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Trackingdaten' },
          },
        },
      },
    },
  };

  return Response.json(schema);
}
