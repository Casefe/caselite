import type { AgentModel, AgentProvider } from '../../preload/caselite-api';

export const providerNames = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  kimi: 'Kimi',
  siliconflow: '硅基流动',
} satisfies Record<AgentProvider, string>;

const modelProviders: Record<AgentModel, AgentProvider> = {
  'gpt-4.1-mini': 'openai',
  'deepseek-flash': 'deepseek',
  'deepseek-v4-pro': 'deepseek',
  'glm-4.7-flash': 'glm',
  'kimi-k2.6': 'kimi',
  'deepseek-ai/DeepSeek-V4-Flash': 'siliconflow',
};
export const agentModels = Object.keys(modelProviders) as AgentModel[];
export const agentProviderFor = (model: AgentModel): AgentProvider => modelProviders[model];
export const agentModelLabel = (model: AgentModel) =>
  `${providerNames[agentProviderFor(model)]} · ${model}`;
