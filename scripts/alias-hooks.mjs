/**
 * Resolve the project's "@/..." alias for Node, and strip TypeScript types.
 * Throwaway: parity scripts only.
 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const rel = specifier.slice(2);
      for (const cand of [`${rel}.ts`, `${rel}/index.ts`, `${rel}.tsx`]) {
        const full = path.join(SRC, cand);
        if (existsSync(full)) {
          return { url: pathToFileURL(full).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
