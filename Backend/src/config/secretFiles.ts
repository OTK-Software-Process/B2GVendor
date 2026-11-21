import { readFileSync } from 'node:fs';

// Secrets from a secret store instead of from .env (ASVS V13.3.1, V13.3.2,
// docs/Security.md section 3).
//
// Docker secrets (docker-compose.prod.yml), Docker Swarm, Kubernetes and the cloud
// secret managers all hand a secret to a container as a FILE (usually under
// /run/secrets/). So for each variable below, `NAME_FILE=/run/secrets/name` makes
// the process read the value from that file. The value never appears in the
// container's environment (`docker inspect`, /proc/<pid>/environ, a crash dump
// of the environment), and a service only gets the files it was granted.
//
// This is the same `_FILE` convention the official mongo and postgres images use.

/** The variables that may be supplied as `<NAME>_FILE`. Only secrets belong here. */
export const SECRET_VARIABLES = ['MONGODB_URI', 'SMTP_PASS', 'OPENROUTER_API_KEY', 'DATA_GO_TH_API_KEY'] as const;

export class SecretFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretFileError';
  }
}

/**
 * For every `<NAME>_FILE` that is set, reads the file and puts its content in
 * `<NAME>`. Called once, before the environment is validated.
 *
 * It refuses, with a message that never contains a secret:
 *   - a variable given both ways (a secret left in .env next to its secret file
 *     would silently win or lose; either way the secret is still in the
 *     environment, which is what this exists to avoid);
 *   - a file that cannot be read, or is empty.
 */
export function loadSecretFiles(environment: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = [];

  for (const name of SECRET_VARIABLES) {
    const fileVariable = `${name}_FILE`;
    const path = environment[fileVariable];
    if (path === undefined || path === '') continue;

    if (environment[name] !== undefined && environment[name] !== '') {
      throw new SecretFileError(`${name} and ${fileVariable} are both set. Keep the secret only in the file and remove ${name} from the environment and from .env.`);
    }

    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
      throw new SecretFileError(`${fileVariable}: cannot read ${path} (${code}).`);
    }

    // `echo secret > file` and most editors end the file with one newline.
    const value = content.replace(/\r?\n$/, '');
    if (value === '') throw new SecretFileError(`${fileVariable}: ${path} is empty.`);

    environment[name] = value;
    loaded.push(name);
  }

  return loaded;
}
