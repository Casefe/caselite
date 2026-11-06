// DEV-1569：只约束当前生产消费者；变更版本或增加框架须重新核对消费卡和许可。
const desktop = {
  '@assistant-ui/react': '0.15.32',
  '@assistant-ui/react-markdown': '0.14.24',
  '@caselite/application': 'workspace:*',
  '@caselite/contracts': 'workspace:*',
  '@caselite/local-db': 'workspace:*',
  '@earendil-works/pi-agent-core': '1.5.0',
  '@earendil-works/pi-ai': '1.5.0',
  '@tiptap/extension-collaboration': '3.32.3',
  '@tiptap/pm': '3.32.3',
  '@tiptap/react': '3.32.3',
  '@tiptap/starter-kit': '3.32.3',
  'pdfjs-dist': '6.3.289',
  react: '19.3.1',
  'react-dom': '19.3.1',
  'react-pdf': '11.0.0',
  yjs: '13.6.33',
};

const admitted = {
  'apps/desktop': desktop,
  'packages/application': { '@caselite/contracts': 'workspace:*' },
  'packages/contracts': { zod: '4.6.7' },
  'packages/local-db': {
    '@caselite/contracts': 'workspace:*',
    'better-sqlite3': '13.0.3',
    'drizzle-orm': '0.45.4',
    yjs: '13.6.33',
  },
};

export function dependencyViolations(manifests) {
  const violations = [];
  for (const manifest of manifests) {
    // Optional/peer 包也能进入运行时，不能用另一个 manifest 字段绕过准入。
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (admitted[manifest.folder]?.[name] !== version)
          violations.push(
            `${manifest.folder}: production dependency requires admission: ${name}@${version} (${field})`,
          );
      }
    }
  }
  return violations;
}

export function runtimeDependencyViolation(manifest, name) {
  if (!manifest.devDependencies?.[name] || manifest.dependencies?.[name]) return null;
  // Electron由Forge提供宿主运行时；其余devDependency不能借webpack成为未准入产品依赖。
  if (manifest.folder === 'apps/desktop' && name === 'electron') return null;
  return `${manifest.folder}: runtime import requires production admission: ${name}`;
}
