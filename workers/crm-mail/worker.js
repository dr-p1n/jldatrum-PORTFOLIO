// DATRUM CRM — email intake.
//
// Cloudflare Email Routing cannot deliver to Pages Functions, so the intake
// lives in its own Worker. It shares the CRM's D1 database and imports the same
// matching code from functions/_crm/db.js, so there is exactly one source of
// truth for how a message is matched to a prospect.
//
// It has no fetch handler on purpose: there is no HTTP surface to secure.

import { handleEmail } from './email.js';

export default {
  async email(message, env, ctx) {
    await handleEmail(message, env);
  },
};
