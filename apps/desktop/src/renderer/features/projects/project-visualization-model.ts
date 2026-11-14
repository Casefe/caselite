import type { Node, Edge } from '@xyflow/react';

export const visualizationModes = {
  relations: {
    label: '关系',
    icon: 'folder',
    title: '法律关系图',
    description: '查看主体、关系标的及双方主张。',
  },
  evidence: {
    label: '证据',
    icon: 'file',
    title: '事实与证据关系图',
    description: '按材料、事实与支持方向查看引用关系。',
  },
  timeline: {
    label: '时间轴',
    icon: 'clock',
    title: '案件时间轴',
    description: '沿时间查看事件、参与主体及出处。',
  },
  confrontation: {
    label: '庭审对抗',
    icon: 'board',
    title: '庭审对抗图',
    description: '按争点并列双方主张、抗辩与待核实项。',
  },
  chronicle: {
    label: '大事记',
    icon: 'list',
    title: '案件大事记',
    description: '以表格查看日期、事件与原文出处。',
  },
  statistics: {
    label: '统计',
    icon: 'wallet',
    title: '金额与资金流',
    description: '按明确口径展示金额、比例与资金方向。',
  },
} as const;
export type VisualizationMode = keyof typeof visualizationModes;
export type VisualizationNodeData = {
  label: string;
  kind:
    | 'entity'
    | 'contract'
    | 'claim'
    | 'evidence'
    | 'fact'
    | 'event'
    | 'matrix'
    | 'chronicle'
    | 'statistics'
    | 'record';
  subtitle?: string;
  tag?: string;
  tone?: 'blue' | 'amber';
  description: string;
  properties: [string, string][];
  columns?: string[];
  rows?: string[][];
};
export type VisualizationNode = Node<VisualizationNodeData, 'visual-card'>;
export type VisualizationGraph = { nodes: VisualizationNode[]; edges: Edge[] };
export type VisualizationLayout = Record<string, { x: number; y: number }>;
export type VisualizationLayoutHistory = {
  past: VisualizationLayout[];
  future: VisualizationLayout[];
};

export function captureVisualizationLayout(nodes: VisualizationNode[]): VisualizationLayout {
  return Object.fromEntries(nodes.map((node) => [node.id, { ...node.position }]));
}

export function applyVisualizationLayout(nodes: VisualizationNode[], layout: VisualizationLayout) {
  // 版面仅含坐标；不得用撤销快照覆盖新读回的标题、日期、金额或来源。
  return nodes.map((node) => ({ ...node, position: { ...(layout[node.id] ?? node.position) } }));
}

export function rememberVisualizationLayout(
  history: VisualizationLayoutHistory,
  before: VisualizationLayout,
  after: VisualizationLayout,
): VisualizationLayoutHistory {
  const ids = Object.keys(before);
  if (
    ids.length === Object.keys(after).length &&
    ids.every((id) => before[id].x === after[id]?.x && before[id].y === after[id]?.y)
  )
    return history;
  return { past: [...history.past, before].slice(-40), future: [] };
}

export function stepVisualizationLayout(
  history: VisualizationLayoutHistory,
  current: VisualizationLayout,
  direction: 'undo' | 'redo',
): { layout: VisualizationLayout; history: VisualizationLayoutHistory } | undefined {
  const source = direction === 'undo' ? history.past : history.future;
  const layout = source.at(-1);
  if (!layout) return undefined;
  return {
    layout,
    history:
      direction === 'undo'
        ? { past: history.past.slice(0, -1), future: [...history.future, current] }
        : { past: [...history.past, current].slice(-40), future: history.future.slice(0, -1) },
  };
}
export type VisualizationInspection = {
  projectId: string;
  mode: VisualizationMode;
  sample: boolean;
  nodeCount: number;
  edgeCount: number;
  selected?: {
    id: string;
    data: VisualizationNodeData;
    destination?: { taskId: string; documentId?: string };
  };
};

const sampleNode = (
  id: string,
  x: number,
  y: number,
  data: VisualizationNodeData,
): VisualizationNode => ({
  id: `sample:${id}`,
  type: 'visual-card',
  position: { x, y },
  data,
});
const sampleEdge = (source: string, target: string, label: string): Edge => ({
  id: `sample:${source}:${target}`,
  source: `sample:${source}`,
  target: `sample:${target}`,
  label,
  type: 'smoothstep',
  markerEnd: { type: 'arrowclosed' },
});

// 仅为显式打开的虚构示例；不保存、不并入项目记录，也不自动选入 AI 输入。
export function sampleVisualization(mode: VisualizationMode): VisualizationGraph {
  if (mode === 'relations')
    return {
      nodes: [
        sampleNode('seller', 0, 0, {
          label: '星桥设备公司',
          kind: 'entity',
          tag: '原告',
          tone: 'blue',
          description: '示例买卖合同中的出卖人。诉讼角色不代表主张已获认定。',
          properties: [
            ['对象类型', '主体'],
            ['示例角色', '出卖人 / 原告'],
            ['关联来源', 'E01 买卖合同 · 第1页'],
          ],
        }),
        sampleNode('contract', 320, 0, {
          label: '设备买卖合同',
          kind: 'contract',
          subtitle: '合同价款 100万元',
          description: '展示买卖双方、合同及诉辩主张。全部为虚构示例。',
          properties: [
            ['对象类型', '合同'],
            ['关联主体', '星桥设备公司、远川制造公司'],
            ['合同金额', '100万元'],
            ['关联来源', 'E01 买卖合同 · 第1页'],
          ],
        }),
        sampleNode('buyer', 640, 0, {
          label: '远川制造公司',
          kind: 'entity',
          tag: '被告',
          description: '示例买卖合同中的买受人。质量异议为当事人主张。',
          properties: [
            ['对象类型', '主体'],
            ['示例角色', '买受人 / 被告'],
          ],
        }),
        sampleNode('claim', 60, 240, {
          label: '请求支付40万元',
          kind: 'claim',
          tag: '原告诉请',
          tone: 'blue',
          description: '仅展示示例原告的诉请，不是法院认定。',
          properties: [
            ['立场', '原告'],
            ['主张金额', '40万元'],
            ['状态', '待审查'],
          ],
        }),
        sampleNode('defense', 580, 240, {
          label: '设备质量异议',
          kind: 'claim',
          tag: '被告抗辩',
          tone: 'amber',
          description: '仅展示示例被告的抗辩，质量是否合格仍待核实。',
          properties: [
            ['立场', '被告'],
            ['争点', '设备质量'],
            ['状态', '待核实'],
          ],
        }),
      ],
      edges: [
        sampleEdge('seller', 'contract', '出卖人'),
        sampleEdge('contract', 'buyer', '买受人'),
        { ...sampleEdge('seller', 'claim', '诉请'), sourceHandle: 'bottom', targetHandle: 'top' },
        { ...sampleEdge('buyer', 'defense', '抗辩'), sourceHandle: 'bottom', targetHandle: 'top' },
      ],
    };
  if (mode === 'evidence') {
    const records = [
      ['E01', '买卖合同', 'F01', '合同价款100万元'],
      ['E02', '交付签收单', 'F02', '设备已交付'],
      ['E03', '银行回单', 'F03', '已付款60万元'],
    ];
    return {
      nodes: records.flatMap(([eid, title, fid, fact], index) => [
        sampleNode(eid, 0, index * 150, {
          label: `${eid} ${title}`,
          kind: 'evidence',
          subtitle: eid === 'E03' ? '第2页' : '第1页',
          description: '示例材料。支持关系及材料真实性仍需人工核验。',
          properties: [
            ['证据编号', eid],
            ['关联事实', fid],
            ['证明方向', '支持'],
            ['出处', `${title} · 第${eid === 'E03' ? 2 : 1}页`],
          ],
        }),
        sampleNode(fid, 430, index * 150, {
          label: `${fid} ${fact}`,
          kind: 'fact',
          description: '依据示例材料提取的候选事实，尚未人工核验。',
          properties: [
            ['事实编号', fid],
            ['关联证据', eid],
            ['核验状态', '待人工核验'],
          ],
        }),
      ]),
      edges: records.map(([eid, , fid]) => sampleEdge(eid, fid, '支持')),
    };
  }
  const events = [
    ['2026-03-01', '签订合同', '100万元', 'E01 · 第1页'],
    ['2026-03-12', '交付设备', '交付签收', 'E02 · 第1页'],
    ['2026-04-10', '支付60万元', '候选事实 F03', 'E03 · 第2页'],
    ['2026-05-08', '提出质量异议', '被告主张', '示例通信记录'],
    ['2026-06-02', '提起诉讼', '原告诉请', '示例起诉状'],
  ];
  if (mode === 'timeline')
    return {
      nodes: events.map(([date, title, detail, source], index) =>
        sampleNode(`event-${index}`, index * 245, index > 2 ? 180 : 0, {
          label: title,
          kind: 'event',
          subtitle: date,
          tag: detail,
          tone: index === 3 ? 'amber' : undefined,
          description: '按日期排序的非等比例时间示意；拖动只改变本次预览位置，不修改日期。',
          properties: [
            ['日期', date],
            ['日期精度', '日'],
            ['关联来源', source],
            ['核验状态', '待人工核验'],
          ],
        }),
      ),
      edges: [],
    };
  if (mode === 'confrontation')
    return {
      nodes: [
        sampleNode('matrix', 0, 0, {
          label: '庭审对抗图',
          kind: 'matrix',
          description: '并列各方主张，均非司法认定。',
          properties: [
            ['争点数量', '2'],
            ['立场', '原告 / 被告'],
            ['核验状态', '待审查'],
          ],
          columns: ['争点', '原告主张', '被告抗辩', '待核实'],
          rows: [
            ['欠付价款', '尚欠40万元', '付款条件有争议', '付款约定、履行情况'],
            ['设备质量', '已交付并签收', '设备存在瑕疵', '质量约定、检验材料'],
          ],
        }),
      ],
      edges: [],
    };
  if (mode === 'chronicle')
    return {
      nodes: [
        sampleNode('chronicle', 0, 0, {
          label: '案件大事记',
          kind: 'chronicle',
          description: '日期、事件与出处使用同一套虚构示例。出处仅为示意，未关联真实材料。',
          properties: [
            ['事件数量', '5'],
            ['时间范围', '2026-03-01 至 2026-06-02'],
            ['出处', '虚构示例，未关联原文'],
          ],
          columns: ['日期', '事件', '事项说明', '出处'],
          rows: events.map((row) => [...row]),
        }),
      ],
      edges: [],
    };
  return {
    nodes: [
      sampleNode('statistics', 0, 0, {
        label: '金额与资金流',
        kind: 'statistics',
        description: '据虚构合同金额与付款金额计算，未付金额不代表法院确认的债权。',
        properties: [
          ['指标', '合同价款与付款'],
          ['统计口径', '示例合同100万元，付款60万元'],
          ['单位', '万元'],
          ['未付金额', '40万元'],
          ['已付比例', '60%'],
        ],
      }),
    ],
    edges: [],
  };
}
