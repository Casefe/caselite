import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// 规格只消费有哈希绑定的本地事实；不把页面文字当作给Agent的指令。
export function readCapture(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.status !== 'PASS_REAL' || !manifest.cleanedUp) throw new Error('CAPTURE_NOT_PASSED');
  const snapshots = {};
  for (const artifact of manifest.artifacts) {
    if (!/^[a-z][a-z0-9-]*\.(png|json)$/.test(artifact.file)) throw new Error('UNSAFE_ARTIFACT');
    const bytes = readFileSync(join(directory, artifact.file));
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
      throw new Error('ARTIFACT_HASH_MISMATCH');
    if (artifact.file.endsWith('.json'))
      snapshots[artifact.file.slice(0, -5)] = JSON.parse(bytes.toString('utf8'));
  }
  return { manifest, snapshots };
}

export function captureSpecification(directory) {
  const { manifest, snapshots } = readCapture(directory);
  return {
    version: 1,
    source: manifest.source,
    sourceArtifacts: manifest.artifacts,
    facts: {
      viewport: manifest.viewport,
      theme: manifest.theme,
      states: manifest.states,
      snapshots,
      actions: manifest.observations,
    },
    implementationInference: {
      components: ['UiCaptureSample', 'InspectorSection', 'PropertyValue'],
      tokens: ['--ink', '--muted', '--line', '--theme-panel', '--theme-hover', '--font'],
      state: 'Local selected/loading/error only; native details owns expansion.',
      tests:
        'Compare visible text geometry/style, selection, keyboard focus and expansion at fixed viewport. Definition-list AX semantics may differ explicitly.',
    },
    notRun: [
      'Backend',
      'Persistence',
      'Permissions',
      'Legal/business rules',
      'Real Linear/native UI',
      'Lawyer acceptance',
    ],
  };
}

export function compareCaptures(reference, implementation) {
  const a = readCapture(reference);
  const b = readCapture(implementation);
  const differences = [];
  let comparisons = 0;
  for (const [state, before] of Object.entries(a.snapshots)) {
    const after = b.snapshots[state];
    if (!after) {
      differences.push(`${state}: missing`);
      continue;
    }
    for (const element of before.dom.filter((n) => n.text || n.tag === 'main')) {
      const actual = after.dom.find(
        (n) => n.text === element.text && (element.text || n.tag === 'main'),
      );
      if (!actual) {
        differences.push(`${state}: visible node missing`);
        continue;
      }
      comparisons++;
      for (const field of ['x', 'y', 'width', 'height'])
        if (Math.abs(element.geometry[field] - actual.geometry[field]) > 1)
          differences.push(`${state}/${element.tag}: geometry.${field}`);
      for (const field of [
        'color',
        'backgroundColor',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'padding',
        'gap',
        'borderRadius',
        'outlineStyle',
        'outlineWidth',
      ])
        if (element.style[field] !== actual.style[field])
          differences.push(`${state}/${element.tag}: style.${field}`);
      for (const field of ['selected', 'focused'])
        if (element[field] !== actual[field]) differences.push(`${state}/${element.tag}: ${field}`);
    }
    if (
      before.dom.find((n) => n.tag === 'details')?.open !==
      after.dom.find((n) => n.tag === 'details')?.open
    )
      differences.push(`${state}: expansion`);
    for (const text of ['合成项目 · 属性', '属性', '模拟加载', '模拟失败'])
      if (!after.aria.includes(text)) differences.push(`${state}: AX name missing`);
  }
  return {
    status: differences.length ? 'FAIL' : 'PASS_REAL',
    comparisons,
    differences,
    axDifference:
      'Own PropertyValue uses dl/dt/dd (term/definition); reference uses neutral spans. Exact AX tree parity is not claimed.',
    limitations: [
      'Fixed light theme and 960x720 synthetic fixture only.',
      'No backend or permission parity inferred.',
    ],
  };
}
