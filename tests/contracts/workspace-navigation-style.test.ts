import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const styles = fileURLToPath(new URL('../../apps/desktop/src/renderer/styles/', import.meta.url));
const navigationOwners = new Set([
  'foundation.css',
  'layout.css',
  'responsive-workspace.css',
  'workspace-tabs.css',
]);
const navigationSelector =
  /\.primary-sidebar\b|\.primary-navigation\b|\.sidebar-nav-group\b|\.workspace-sidebar-heading\b/;
const sharedNavigationClasses = new Set([
  'workbench',
  'is-collapsed',
  'primary-sidebar',
  'primary-navigation',
  'sidebar-nav-group',
  'sidebar-bottom',
  'workspace-sidebar-heading',
  'workspace-topbar-brand',
  'brand-logo',
]);
const navigationWidthProperty = /^--workspace-navigation-(?:collapsed-)?width$/;
const geometryProperty =
  /^(?:width|min-width|max-width|height|min-height|max-height|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|(?:row-|column-)?gap|display|flex-direction|justify-content|align-items|place-items|grid-template-columns|grid-template-rows|grid-column|grid-row|position|inset|left|right|top|bottom|transform|translate|scale|order|flex(?:-basis)?|overflow|font-size|line-height)$/;

function rootWorkbenchClauses(selector: string) {
  // 伪类参数可包含逗号；先隐藏参数，再拆分选择器列表。
  return selector
    .replace(/\([^()]*\)/g, '()')
    .split(',')
    .map((clause) => clause.trim())
    .filter((clause) => /^\.workbench(?=$|[.:[#])/.test(clause) && !/\s/.test(clause));
}

function navigationGeometryViolations(file: string, css: string) {
  const violations: string[] = [];
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const properties = match[2]
      .split(';')
      .map((declaration) => declaration.split(':', 1)[0].trim())
      .filter(
        (property) => geometryProperty.test(property) || navigationWidthProperty.test(property),
      );
    if (properties.length === 0) continue;
    const rootClauses = rootWorkbenchClauses(selector);
    const navProperties = properties.filter((property) => navigationWidthProperty.test(property));
    const protectedGeometry = navigationSelector.test(selector) || rootClauses.length > 0;
    if (!protectedGeometry && navProperties.length === 0) continue;
    const pageAttributes = Array.from(selector.matchAll(/\[data-([a-z-]+)(?:[=\]])/g))
      .map((attribute) => attribute[1])
      .filter((attribute) => !['navigation-hidden', 'navigation-overlay'].includes(attribute));
    const responsiveRoot =
      selector.replace(/\s+/g, '') ===
      ".workbench:is([data-navigation-hidden='true'],[data-navigation-overlay='true'])";
    const unexpectedRoot = rootClauses.some(
      (clause) =>
        !['.workbench', '.workbench.is-collapsed'].includes(clause) &&
        !(clause === '.workbench:is()' && responsiveRoot),
    );
    const unexpectedClass = Array.from(selector.matchAll(/\.([a-z][a-z0-9-]*)/g)).some(
      (match) => !sharedNavigationClasses.has(match[1]),
    );
    if (
      !navigationOwners.has(file) ||
      pageAttributes.length > 0 ||
      unexpectedRoot ||
      unexpectedClass ||
      (navProperties.length > 0 && file !== 'layout.css')
    )
      violations.push(`${file}: ${selector} (${properties.join(', ')})`);
  }
  return violations;
}

it('keeps first-level navigation geometry in shared style owners across pages', () => {
  const violations = readdirSync(styles)
    .filter((name) => name.endsWith('.css'))
    .flatMap((file) =>
      navigationGeometryViolations(
        file,
        readFileSync(
          new URL(`../../apps/desktop/src/renderer/styles/${file}`, import.meta.url),
          'utf8',
        ),
      ),
    );
  expect(violations).toEqual([]);
});

it('rejects the former page-specific home rail override while allowing responsive navigation', () => {
  expect(
    navigationGeometryViolations(
      'agent-home-workspace.css',
      `.workbench[data-home-rail='true'] { grid-template-columns: 64px minmax(0, 1fr); }
       .workbench[data-home-rail='true'] > .primary-sidebar { width: 64px; }
       .workbench[data-home-rail='true'] .primary-navigation button { min-height: 54px; }`,
    ),
  ).toHaveLength(3);
  expect(
    navigationGeometryViolations(
      'agent-home-workspace.css',
      `.workbench:has(.agent-home) { --workspace-navigation-width: 64px; }`,
    ),
  ).toHaveLength(1);
  expect(
    navigationGeometryViolations(
      'layout.css',
      `.workbench:is(.home-page) { grid-template-columns: 64px minmax(0, 1fr); }`,
    ),
  ).toHaveLength(1);
  expect(
    navigationGeometryViolations(
      'layout.css',
      `.home-page .primary-navigation button { min-height: 54px; }
       .workbench:has(.agent-home) > .primary-sidebar { width: 64px; }
       .home-page .sidebar-nav-group { row-gap: 12px; }`,
    ),
  ).toHaveLength(3);
  expect(
    navigationGeometryViolations(
      'responsive-workspace.css',
      `.workbench[data-navigation-overlay='true'] > .primary-sidebar { position: fixed; }`,
    ),
  ).toEqual([]);
});
