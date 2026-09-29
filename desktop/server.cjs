/* eslint-disable @typescript-eslint/no-require-imports */
// Electron's bundled Node runtime runs this entry in an isolated utility process.
const { pathToFileURL } = require('node:url');
const path = require('node:path');
import(pathToFileURL(path.join(process.env.UNTERWEGS_RUNTIME_DIR, 'server.js')).href)
  .catch((error) => { console.error(error); process.exit(1); });
