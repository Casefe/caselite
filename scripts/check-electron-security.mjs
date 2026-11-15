import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parse, sourceFiles } from './lib/source-analysis.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = {
  forge: 'apps/desktop/forge.config.mjs',
  html: 'apps/desktop/src/renderer/index.html',
  main: 'apps/desktop/src/main/index.ts',
  preload: 'apps/desktop/src/preload/index.ts',
};

const requiredFragments = {
  [files.forge]: [
    'FuseV1Options.RunAsNode]: false',
    'FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false',
    'FuseV1Options.EnableNodeCliInspectArguments]: false',
    'FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true',
    'FuseV1Options.OnlyLoadAppFromAsar]: true',
    "default-src 'none'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "object-src 'none'",
  ],
  [files.html]: [
    "default-src 'none'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "script-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "object-src 'none'",
  ],
  [files.main]: [
    'contextIsolation: true',
    'sandbox: true',
    'nodeIntegration: false',
    'webSecurity: true',
    'webviewTag: false',
    "setWindowOpenHandler(() => ({ action: 'deny' }))",
    "'will-navigate'",
    "'will-redirect'",
    "'will-attach-webview'",
    'setPermissionRequestHandler',
    'setPermissionCheckHandler',
    "'will-download'",
  ],
  [files.preload]: ['contextBridge.exposeInMainWorld', "'caselite'"],
};

export function checkElectronSecurity(root = repositoryRoot) {
  const violations = [];
  for (const [file, fragments] of Object.entries(requiredFragments)) {
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const fragment of fragments) {
      if (!source.includes(fragment)) violations.push(`${file}: missing ${fragment}`);
    }
  }

  const preloadSource = readFileSync(resolve(root, files.preload), 'utf8');
  if (preloadSource.includes("contextBridge.exposeInMainWorld('ipcRenderer'")) {
    violations.push(`${files.preload}: must not expose generic ipcRenderer`);
  }

  const sources = ['main', 'preload'].flatMap((area) =>
    sourceFiles(resolve(root, `apps/desktop/src/${area}`))
      .filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
      .map((file) => ({ file: file.slice(root.length + 1), source: readFileSync(file, 'utf8') })),
  );
  const analysis = analyzeElectronSources(sources);
  return { ...analysis, violations: [...violations, ...analysis.violations] };
}

const safePreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
};
const approvedPreloads = {
  'apps/desktop/src/main/index.ts': 'MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY',
  'apps/desktop/src/main/legal-consent-window.ts': 'LEGAL_WINDOW_PRELOAD_WEBPACK_ENTRY',
};
const propertyName = (node) =>
  node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : null;
const unwrap = (node) =>
  node &&
  (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    ? unwrap(node.expression)
    : node;
const method = (node) =>
  ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node)
      ? propertyName(node.argumentExpression)
      : null;
const receiver = (node) =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ? node.expression
    : null;
function property(object, name) {
  object = unwrap(object);
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  let value;
  for (const item of object.properties) {
    // 后来的展开/计算键可能覆盖任何安全属性，只有后续明确赋值能重新证明该属性。
    if (ts.isSpreadAssignment(item) || !propertyName(item.name)) value = undefined;
    else if (propertyName(item.name) === name)
      value = ts.isPropertyAssignment(item) ? unwrap(item.initializer) : undefined;
  }
  return value;
}
function directReturn(callback) {
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)))
    return undefined;
  const body = unwrap(callback.body);
  if (!ts.isBlock(body)) return body;
  return body.statements.length === 1 && ts.isReturnStatement(body.statements[0])
    ? unwrap(body.statements[0].expression)
    : undefined;
}
function callbackEffect(callback) {
  const result = directReturn(callback);
  if (result) return result;
  if (
    callback &&
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
    ts.isBlock(callback.body) &&
    callback.body.statements.length === 1 &&
    ts.isExpressionStatement(callback.body.statements[0])
  )
    return unwrap(callback.body.statements[0].expression);
  return undefined;
}
function returnsImmediately(statement) {
  return (
    ts.isReturnStatement(statement) ||
    (ts.isBlock(statement) &&
      statement.statements.length === 1 &&
      ts.isReturnStatement(statement.statements[0]))
  );
}

// 这是有界语法门禁，不执行源码，也不把回调名或注释当作权限证明。
export function analyzeElectronSources(sources) {
  const violations = [],
    inventory = [],
    manualReview = [];
  for (const { file, source } of sources) {
    const tree = parse(source, file);
    const point = (node) =>
      `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`;
    const reject = (node, message) => violations.push(`${point(node)}: ${message}`);
    const windowNames = new Set(),
      namespaces = new Set(),
      ipcNames = new Set(['ipcMain']),
      rawIpcNames = new Set();
    const guards = new Set();
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (statement.moduleSpecifier.text === 'electron' && bindings) {
        if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        else
          for (const item of bindings.elements) {
            const original = (item.propertyName ?? item.name).text;
            if (original === 'BrowserWindow') windowNames.add(item.name.text);
            if (original === 'ipcMain') ipcNames.add(item.name.text);
            if (original === 'ipcRenderer') rawIpcNames.add(item.name.text);
          }
      }
      if (
        resolve('/', file, '..', statement.moduleSpecifier.text) ===
          '/apps/desktop/src/main/ipc/window-capabilities' &&
        bindings &&
        ts.isNamedImports(bindings)
      )
        for (const item of bindings.elements)
          if (
            ['isTrustedBusinessSender', 'isTrustedConsentSender'].includes(
              (item.propertyName ?? item.name).text,
            )
          )
            guards.add(item.name.text);
    }
    function removeShadowedGuards(node) {
      if (
        (ts.isVariableDeclaration(node) ||
          ts.isParameter(node) ||
          ts.isFunctionDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      )
        guards.delete(node.name.text);
      ts.forEachChild(node, removeShadowedGuards);
    }
    removeShadowedGuards(tree);
    const isWindow = (node) =>
      ts.isIdentifier(node)
        ? windowNames.has(node.text)
        : method(node) === 'BrowserWindow' &&
          ts.isIdentifier(receiver(node)) &&
          namespaces.has(receiver(node).text);
    if (
      [
        'apps/desktop/src/main/window-capability-probe.ts',
        'apps/desktop/src/main/appearance-flash-demo.ts',
      ].includes(file)
    ) {
      manualReview.push(
        `${file}: engineering/demo entry excluded from production gate; runtime and build exclusion require review`,
      );
      continue;
    }
    if (tree.parseDiagnostics.length)
      reject(tree, 'source parse failed; cannot establish security properties');
    function walk(node) {
      if (ts.isNewExpression(node) && isWindow(node.expression)) {
        inventory.push({ kind: 'BrowserWindow', location: point(node) });
        const options = node.arguments?.[0],
          preferences = property(options, 'webPreferences');
        for (const [key, expected] of Object.entries(safePreferences)) {
          const value = property(preferences, key);
          if (value?.kind !== (expected ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword))
            reject(
              node,
              `webPreferences.${key} must be literal ${expected}; missing/dynamic values require review`,
            );
        }
        const preload = property(preferences, 'preload');
        // 无preload窗口也拒绝无法解析的展开，避免展开隐藏业务preload/session。
        if (
          !preferences ||
          !ts.isObjectLiteralExpression(preferences) ||
          preferences.properties.some(
            (item) => ts.isSpreadAssignment(item) || !propertyName(item.name),
          )
        )
          reject(node, 'webPreferences must be an explicit object without spread/computed keys');
        if (preload && (!ts.isIdentifier(preload) || preload.text !== approvedPreloads[file]))
          reject(preload, 'unapproved preload; register the consumer after independent review');
        if (
          approvedPreloads[file] &&
          (!preload || !ts.isIdentifier(preload) || preload.text !== approvedPreloads[file])
        )
          reject(node, 'approved production preload missing or dynamic');
        const declaration = node.parent;
        const statement = declaration.parent?.parent;
        const block = statement?.parent;
        const variable =
          ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
            ? declaration.name.text
            : null;
        const calls = [];
        const laterPopupCalls = [];
        if (variable && block && (ts.isBlock(block) || ts.isSourceFile(block))) {
          let after = false;
          let loaded = false;
          for (const sibling of block.statements) {
            if (sibling === statement) {
              after = true;
              continue;
            }
            if (after) {
              let loadsWindow = false;
              const findLoad = (part) => {
                if (
                  ts.isCallExpression(part) &&
                  ['loadURL', 'loadFile'].includes(method(part.expression)) &&
                  receiver(part.expression)?.getText(tree) === variable
                )
                  loadsWindow = true;
                ts.forEachChild(part, findLoad);
              };
              findLoad(sibling);
              if (loadsWindow) loaded = true;
            }
            if (
              !after ||
              !ts.isExpressionStatement(sibling) ||
              !ts.isCallExpression(sibling.expression)
            )
              continue;
            const call = sibling.expression,
              target = receiver(call.expression);
            if (
              target &&
              ts.isPropertyAccessExpression(target) &&
              target.name.text === 'webContents' &&
              ts.isIdentifier(target.expression) &&
              target.expression.text === variable
            )
              if (!loaded) calls.push(call);
              else if (method(call.expression) === 'setWindowOpenHandler')
                laterPopupCalls.push(call);
          }
        }
        const popupCalls = calls.filter(
          (call) => method(call.expression) === 'setWindowOpenHandler',
        );
        const deniesPopup = (call) => {
          const action = property(directReturn(call.arguments[0]), 'action');
          return (
            method(call.expression) === 'setWindowOpenHandler' &&
            action &&
            ts.isStringLiteralLike(action) &&
            action.text === 'deny'
          );
        };
        // 此API后注册覆盖前值；加载前的最后策略必须拒绝，加载后的直接改写也不能放开弹窗。
        const finalPopup = popupCalls.at(-1);
        if (!finalPopup || !deniesPopup(finalPopup) || !laterPopupCalls.every(deniesPopup))
          reject(
            node,
            'window requires effective deny-only setWindowOpenHandler before load and on later direct updates',
          );
        for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
          const denies = calls.some((call) => {
            if (method(call.expression) !== 'on' || call.arguments[0]?.text !== event) return false;
            const callback = call.arguments[1],
              expression = callbackEffect(callback);
            return (
              expression &&
              ts.isCallExpression(expression) &&
              method(expression.expression) === 'preventDefault' &&
              ts.isIdentifier(receiver(expression.expression)) &&
              receiver(expression.expression).text === callback.parameters[0]?.name.getText(tree) &&
              expression.arguments.length === 0
            );
          });
          if (!denies) reject(node, `window requires unconditional ${event} preventDefault`);
        }
        manualReview.push(
          `${point(node)}: session/resource URL allowlist, effective runtime preferences, load order and packaged entry still require runtime review`,
        );
      }
      if (ts.isCallExpression(node)) {
        const name = method(node.expression);
        if (
          ['setPermissionRequestHandler', 'setPermissionCheckHandler', 'onBeforeRequest'].includes(
            name,
          )
        ) {
          inventory.push({ kind: name, location: point(node) });
          const callback = node.arguments[node.arguments.length - 1],
            result = callbackEffect(callback);
          if (
            name !== 'onBeforeRequest' &&
            (!callback || callback.kind === ts.SyntaxKind.NullKeyword)
          )
            reject(node, `${name} must not reset the security handler`);
          if (name === 'setPermissionCheckHandler' && result?.kind === ts.SyntaxKind.TrueKeyword)
            reject(node, 'blanket permission check grant');
          if (
            name === 'setPermissionRequestHandler' &&
            result &&
            ts.isCallExpression(result) &&
            result.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword
          )
            reject(node, 'blanket permission request grant');
          if (
            name === 'onBeforeRequest' &&
            result &&
            ts.isCallExpression(result) &&
            property(result.arguments[0], 'cancel')?.kind === ts.SyntaxKind.FalseKeyword
          )
            reject(node, 'blanket session resource allow');
          manualReview.push(
            `${point(node)}: only direct blanket grant/reset is checked; conditional session policy requires review`,
          );
        }
        if (name === 'exposeInMainWorld') {
          inventory.push({ kind: 'preload-exposure', location: point(node) });
          const raw = node.arguments[1];
          if (
            node.arguments[0]?.text === 'ipcRenderer' ||
            (raw && ts.isIdentifier(raw) && rawIpcNames.has(raw.text))
          )
            reject(node, 'generic ipcRenderer exposure');
        }
        const target = receiver(node.expression);
        if (name === 'handle' && target && ts.isIdentifier(target) && ipcNames.has(target.text)) {
          inventory.push({ kind: 'IPC-handle', location: point(node) });
          const callback = node.arguments[1],
            event = callback?.parameters?.[0]?.name;
          if (
            !callback ||
            !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ||
            !ts.isBlock(callback.body) ||
            !event ||
            !ts.isIdentifier(event)
          )
            reject(node, 'IPC handler requires explicit callback and sender rejection');
          else {
            const negativeGuard = (condition) => {
              condition = unwrap(condition);
              if (
                ts.isBinaryExpression(condition) &&
                condition.operatorToken.kind === ts.SyntaxKind.BarBarToken
              )
                return negativeGuard(condition.left) || negativeGuard(condition.right);
              if (
                !ts.isPrefixUnaryExpression(condition) ||
                condition.operator !== ts.SyntaxKind.ExclamationToken
              )
                return false;
              const call = unwrap(condition.operand);
              return (
                ts.isCallExpression(call) &&
                ts.isIdentifier(call.expression) &&
                guards.has(call.expression.text) &&
                call.arguments.length === 1 &&
                ts.isIdentifier(call.arguments[0]) &&
                call.arguments[0].text === event.text
              );
            };
            // 注入式isTrustedSender由既有1861测试保护；本片不把名称当独立权限证明。
            if (file.endsWith('/register-application-ipc.ts'))
              manualReview.push(
                `${point(node)}: injected isTrustedSender wiring excluded from static guard proof; existing capability tests required`,
              );
            else if (
              !callback.body.statements[0] ||
              !ts.isIfStatement(callback.body.statements[0]) ||
              !negativeGuard(callback.body.statements[0].expression) ||
              !returnsImmediately(callback.body.statements[0].thenStatement)
            )
              reject(
                node,
                'IPC first statement must reject untrusted sender with immediate return',
              );
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(tree);
  }
  return { violations, inventory, manualReview };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = checkElectronSecurity();
  for (const item of report.manualReview) console.log(`MANUAL_REVIEW: ${item}`);
  if (report.violations.length) {
    console.error('Electron security baseline check failed:');
    for (const violation of report.violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else
    console.log(
      `Electron security baseline check passed for selected static properties (${report.inventory.length} entries); runtime, dynamic policies and packaged artifacts remain unverified.`,
    );
}
