import ts from 'typescript';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (
      ['node_modules', '.git', '.webpack', 'out', 'artifacts', 'coverage', 'fixtures'].includes(
        entry.name,
      )
    )
      return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}

export function parse(source, file = 'source.ts') {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

export function imports(source, file) {
  const entries = [];
  const tree = parse(source, file);
  const add = (node, typeOnly = false) => {
    entries.push({ specifier: node && ts.isStringLiteralLike(node) ? node.text : null, typeOnly });
  };
  function walk(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause?.isTypeOnly ||
        (bindings &&
          ts.isNamedImports(bindings) &&
          !clause.name &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly));
      add(node.moduleSpecifier, Boolean(typeOnly));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, node.isTypeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, true);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return entries;
}

export function forbiddenTestModifiers(source, file) {
  const found = [];
  const tree = parse(source, file);
  const aliases = new Set(['test', 'it', 'describe']);
  const namespaces = new Set();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'vitest') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (['test', 'it', 'describe'].includes((item.propertyName ?? item.name).text))
          aliases.add(item.name.text);
      }
    }
  }
  function chain(node) {
    if (ts.isIdentifier(node)) return [node.text];
    if (ts.isPropertyAccessExpression(node)) return [...chain(node.expression), node.name.text];
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression)
    )
      return [...chain(node.expression), node.argumentExpression.text];
    if (ts.isCallExpression(node)) return chain(node.expression);
    return [];
  }
  function walk(node) {
    if (ts.isCallExpression(node)) {
      const parts = chain(node.expression);
      if (
        (aliases.has(parts[0]) ||
          (namespaces.has(parts[0]) && ['test', 'it', 'describe'].includes(parts[1]))) &&
        parts.some((part) => ['skip', 'only', 'todo', 'skipIf', 'runIf'].includes(part))
      )
        found.push(node.expression.getText(tree));
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return [...new Set(found)];
}
