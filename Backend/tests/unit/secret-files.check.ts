import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSecretFiles, SECRET_VARIABLES, SecretFileError } from '../../src/config/secretFiles';

// Secrets from files (ASVS V13.3.1, V13.3.2): NAME_FILE=/run/secrets/name puts the
// file's content in NAME before the environment is validated, so a secret store can
// hand each service only the secrets it needs, without them sitting in the
// container's environment. Run: npm run check:secret-files

const results: string[] = [];
function record(pass: boolean, label: string, detail = ''): void {
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

function throwsSecretFileError(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof SecretFileError ? error.message : `wrong error: ${String(error)}`;
  }
}

function main(): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'b2g-secrets-'));
  const file = (name: string, content: string): string => {
    const full = path.join(dir, name);
    writeFileSync(full, content);
    return full;
  };

  try {
    // 1. the four secrets are the ones that can come from a file
    record(
      [...SECRET_VARIABLES].sort().join(',') === ['DATA_GO_TH_API_KEY', 'MFA_ENCRYPTION_KEY', 'MONGODB_URI', 'OPENROUTER_API_KEY', 'SMTP_PASS'].sort().join(','),
      'the secrets that can come from a file are MONGODB_URI, SMTP_PASS, OPENROUTER_API_KEY, DATA_GO_TH_API_KEY and MFA_ENCRYPTION_KEY'
    );

    // 2. a value is read, with one trailing newline removed
    const env: NodeJS.ProcessEnv = {
      SMTP_PASS_FILE: file('smtp_pass', 'p@ss word:with/odd=chars\n'),
      MONGODB_URI_FILE: file('mongo_uri', 'mongodb://b2g_api:abc@mongo:27017/b2gvendor?tls=true'),
      UNRELATED: 'left alone'
    };
    const loaded = loadSecretFiles(env);
    record(env.SMTP_PASS === 'p@ss word:with/odd=chars', 'the file content becomes the variable, with the one trailing newline removed', JSON.stringify(env.SMTP_PASS));
    record(env.MONGODB_URI === 'mongodb://b2g_api:abc@mongo:27017/b2gvendor?tls=true', 'a value without a newline is kept as it is');
    record(loaded.sort().join(',') === 'MONGODB_URI,SMTP_PASS', 'it reports which variables it filled', loaded.join(','));
    record(env.UNRELATED === 'left alone' && env.OPENROUTER_API_KEY === undefined, 'a variable with no _FILE is left alone');

    // 3. only ONE newline goes; a secret may legitimately end in more
    const two: NodeJS.ProcessEnv = { OPENROUTER_API_KEY_FILE: file('two_newlines', 'key\n\n') };
    loadSecretFiles(two);
    record(two.OPENROUTER_API_KEY === 'key\n', 'only one trailing newline is removed (Windows CRLF counts as one)');
    const crlf: NodeJS.ProcessEnv = { OPENROUTER_API_KEY_FILE: file('crlf', 'key\r\n') };
    loadSecretFiles(crlf);
    record(crlf.OPENROUTER_API_KEY === 'key', 'a CRLF line ending is removed as one');

    // 4. an empty _FILE variable means "not used" (compose passes empty strings for unset variables)
    const blank: NodeJS.ProcessEnv = { SMTP_PASS_FILE: '' };
    loadSecretFiles(blank);
    record(blank.SMTP_PASS === undefined, 'an empty SMTP_PASS_FILE is ignored');

    // 5. refusals, each without the secret in the message
    const both: NodeJS.ProcessEnv = { SMTP_PASS: 'from-env-SECRET', SMTP_PASS_FILE: file('both', 'from-file-SECRET') };
    const bothMessage = throwsSecretFileError(() => loadSecretFiles(both));
    record(bothMessage !== null && bothMessage.includes('SMTP_PASS and SMTP_PASS_FILE are both set'), 'a secret given both as a variable and as a file is refused', bothMessage ?? 'no error');
    record(bothMessage !== null && !bothMessage.includes('SECRET'), 'the message never contains either value');

    const missing = path.join(dir, 'does-not-exist');
    const missingMessage = throwsSecretFileError(() => loadSecretFiles({ DATA_GO_TH_API_KEY_FILE: missing }));
    record(missingMessage !== null && missingMessage.includes('DATA_GO_TH_API_KEY_FILE') && missingMessage.includes('ENOENT'), 'a file that does not exist is refused, naming the variable and the reason', missingMessage ?? 'no error');

    const emptyMessage = throwsSecretFileError(() => loadSecretFiles({ SMTP_PASS_FILE: file('empty', '') }));
    record(emptyMessage !== null && emptyMessage.includes('is empty'), 'an empty file is refused', emptyMessage ?? 'no error');
    const newlineOnly = throwsSecretFileError(() => loadSecretFiles({ SMTP_PASS_FILE: file('only_newline', '\n') }));
    record(newlineOnly !== null && newlineOnly.includes('is empty'), 'a file holding only a newline counts as empty');

    // a directory (a secret mounted wrongly) and an unreadable file
    const directoryMessage = throwsSecretFileError(() => loadSecretFiles({ SMTP_PASS_FILE: dir }));
    record(directoryMessage !== null && directoryMessage.includes('cannot read'), 'a directory in place of a file is refused', directoryMessage ?? 'no error');
    if (process.getuid && process.getuid() !== 0) {
      const locked = file('locked', 'secret');
      chmodSync(locked, 0o000);
      const lockedMessage = throwsSecretFileError(() => loadSecretFiles({ SMTP_PASS_FILE: locked }));
      record(lockedMessage !== null && lockedMessage.includes('EACCES'), 'a file the process may not read is refused', lockedMessage ?? 'no error');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(results.join('\n'));
  const failures = results.filter(line => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
