import mongoose from 'mongoose';
import { AUDIT_PLUGIN_FLAG, auditPlugin } from './plugin';
import { registeredModelNames } from './registry';

// IMPORT THIS FIRST. Mongoose adds a plugin's hooks only to models compiled
// AFTER the plugin is registered, so this module must run before any model
// file loads (it is the first import of app.ts and worker.ts). Importing it
// more than once is harmless.
mongoose.plugin(auditPlugin, { deduplicate: true });

/**
 * Checks that every model in the registry is actually being audited. A model
 * compiled before this plugin was installed would otherwise fail SILENTLY:
 * its changes would simply never be recorded. Returns human-readable problems
 * (empty = all good); the server logs them at startup.
 */
export function verifyAuditSetup(): string[] {
  const problems: string[] = [];
  for (const name of registeredModelNames()) {
    const model = mongoose.models[name];
    if (!model) {
      problems.push(`"${name}" is in the audit registry but no model with that name is loaded (typo, or the model is never imported).`);
    } else if ((model.schema as unknown as Record<string, unknown>)[AUDIT_PLUGIN_FLAG] !== true) {
      problems.push(`"${name}" was compiled before the audit plugin was installed, so its changes are NOT being recorded. Import './audit/install' earlier.`);
    }
  }
  return problems;
}
