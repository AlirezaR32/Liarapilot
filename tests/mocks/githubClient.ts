// Test fixture: mocked GitHub client (deterministic, offline). Used by unit +
// integration tests so the REAL analysis/graph code runs against a stable repo.
export const FIXTURE_COMMIT_SHA = '3f5c1ab9e2d4c7a8b6d5e4f3a2b1c0d9e8f7a6b5';

export const FIXTURE_REPO: Record<string, string> = {
  'README.md': `# Orders API

A small Node.js + Express REST service for order processing.

## Running locally

    npm install
    npm run build
    npm start

The service listens on PORT (default 3000) and requires:

- DATABASE_URL — PostgreSQL connection string
- JWT_SECRET — signing key for auth tokens

## Health

GET /health returns 200 when the service is ready.
`,
  'package.json': JSON.stringify(
    {
      name: 'orders-api',
      version: '1.2.0',
      private: true,
      engines: { node: '>=20' },
      scripts: {
        build: 'tsc -p tsconfig.json',
        start: 'node dist/server.js',
        dev: 'ts-node src/server.ts',
      },
      dependencies: { express: '^4.19.0', pg: '^8.11.0', jsonwebtoken: '^9.0.0' },
      devDependencies: { typescript: '^5.4.0', 'ts-node': '^10.9.0' },
    },
    null,
    2,
  ),
  'package-lock.json': '{ "name": "orders-api", "lockfileVersion": 3, "packages": {} }',
  'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'dist', rootDir: 'src', target: 'ES2022' }, include: ['src'] }, null, 2),
  '.env.example': '# Copy to .env and fill values\nDATABASE_URL=\nJWT_SECRET=\nPORT=3000\nLOG_LEVEL=info\n',
  'src/server.ts': `import express from 'express';
const app = express();
const port = Number(process.env.PORT || 3000);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(port, () => console.log('listening on', port));
`,
  'Dockerfile': `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
CMD ["node", "dist/server.js"]
`,
  '.dockerignore': 'node_modules\ndist\n.env\n',
};

export class GitHubError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

function fileFor(path: string) {
  const content = FIXTURE_REPO[path];
  const size = content?.length ?? 0;
  return { path, size, content: content ?? null };
}

export async function fetchRepoMetadata(ref: { owner: string; repo: string }) {
  return {
    fullName: `${ref.owner}/${ref.repo}`,
    defaultBranch: 'main',
    description: 'Fixture repository used by LiaraPilot tests (deterministic, offline)',
    pushedAt: new Date().toISOString(),
    stars: 0,
    private: false,
  };
}

export async function fetchLatestCommit(ref: { owner: string; repo: string }) {
  return { sha: FIXTURE_COMMIT_SHA, message: 'feat: initial fixture', date: new Date().toISOString() };
}

export async function fetchRootListing() {
  return Object.keys(FIXTURE_REPO);
}

export async function fetchFile(_ref: unknown, path: string) {
  return fileFor(path);
}

export async function fetchFiles(_ref: unknown, paths: string[]) {
  return paths.map(fileFor);
}
