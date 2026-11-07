import type { AgentModel, AgentProvider } from '../../preload/caselite-api';

export const agentProviderFor = (model: AgentModel): AgentProvider =>
  model === 'gpt-4.1-mini' ? 'openai' : 'deepseek';
export const agentModelLabel = (model: AgentModel) =>
  `${agentProviderFor(model) === 'openai' ? 'OpenAI' : 'DeepSeek'} · ${model}`;
