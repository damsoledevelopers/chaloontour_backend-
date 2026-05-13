/**
 * cPanel Passenger Entry Point
 * ============================
 * cPanel's "Setup Node.js App" uses Phusion Passenger, which requires:
 *   1. An `app.js` file at the application root
 *   2. The Express app exported via `module.exports`
 *
 * Passenger manages the port automatically — it does NOT use app.listen().
 * The app.listen() in index.js is harmless; Passenger ignores it and binds
 * its own socket.
 *
 * Usage in cPanel:
 *   Application root:  /home/<username>/backend  (or wherever you place backend files)
 *   Application URL:   api.yourdomain.com  (set up a subdomain)
 *   Application startup file:  app.js
 */

const app = require('./index');
module.exports = app;
