// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRequest, AgentResponse } from '../../preload/caselite-api';
import SettingsView from './SettingsView';

afterEach(cleanup);
const response = (configured: boolean): AgentResponse => ({
  ok: true,
  configured,
  providers: { openai: configured, deepseek: false },
  model: 'gpt-4.1-mini',
  runs: [],
});
function show() {
  return render(<SettingsView section="模型" onSection={vi.fn()} onBack={vi.fn()} />);
}
describe('central model settings', () => {
  it('clears entered credentials, reports failure without claiming saved, and requires delete confirmation', async () => {
    let configured = false;
    let fail = true;
    const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
      if (request.operation === 'configure') {
        if (fail) return { ok: false, code: 'RESULT_UNKNOWN', message: '请核对配置结果' };
        configured = true;
      }
      if (request.operation === 'clear_key') configured = false;
      return response(configured);
    });
    window.caselite = { agent } as unknown as Window['caselite'];
    show();
    await screen.findAllByText('未配置');
    const input = screen.getByLabelText('OpenAI API Key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-' + 'synthetic-settings-test' } });
    fireEvent.click(screen.getByText('保存 Key'));
    await screen.findByRole('alert');
    expect(input.value).toBe('');
    expect(screen.queryByText('已保存')).toBeNull();
    expect((screen.getByText('删除 Key') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('重新读取状态'));
    await screen.findAllByText('未配置');
    fail = false;
    fireEvent.change(input, { target: { value: 'sk-' + 'synthetic-settings-test' } });
    fireEvent.click(screen.getByText('保存 Key'));
    await screen.findByText('已保存');
    expect(input.value).toBe('');
    fireEvent.click(screen.getByText('删除 Key'));
    expect(agent.mock.calls.filter(([r]) => r.operation === 'clear_key')).toHaveLength(0);
    fireEvent.click(screen.getByText('取消'));
    expect(agent.mock.calls.filter(([r]) => r.operation === 'clear_key')).toHaveLength(0);
    fireEvent.click(screen.getByText('删除 Key'));
    fireEvent.click(screen.getByText('确认删除'));
    await screen.findAllByText('未配置');
    expect(agent.mock.calls.filter(([r]) => r.operation === 'clear_key')).toHaveLength(1);
  });
  it('does not collect or submit credentials for preview-only services', async () => {
    const agent = vi.fn(async () => response(false));
    window.caselite = { agent } as unknown as Window['caselite'];
    show();
    await waitFor(() => expect(screen.getAllByText('未配置').length).toBeGreaterThan(0));
    for (const name of ['MinerU OCR', '元典']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
      expect((screen.getByLabelText(`${name} API Key`) as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByText('保存 Key') as HTMLButtonElement).disabled).toBe(true);
    }
    expect(agent).toHaveBeenCalledTimes(1);
    expect(agent).toHaveBeenCalledWith({ protocol_version: 1, operation: 'profile' });
  });
  it('saves a separate DeepSeek key and explicitly selects the default model without sending a prompt', async () => {
    let state: AgentResponse = {
      ok: true,
      configured: true,
      providers: { openai: true, deepseek: false },
      model: 'gpt-4.1-mini',
      runs: [],
    };
    const agent = vi.fn(async (r: AgentRequest): Promise<AgentResponse> => {
      if (r.operation === 'configure') {
        expect(r.provider).toBe('deepseek');
        state = { ...state, providers: { openai: true, deepseek: true } };
      }
      if (r.operation === 'select_model') state = { ...state, model: r.model };
      if (r.operation === 'clear_key') {
        expect(r.provider).toBe('deepseek');
        state = { ...state, configured: false, providers: { openai: true, deepseek: false } };
      }
      return state;
    });
    window.caselite = { agent } as unknown as Window['caselite'];
    show();
    await screen.findByText('已保存');
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek/ }));
    expect((screen.getByText('设为默认模型') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('DeepSeek API Key'), {
      target: { value: 'sk-synthetic-deepseek' },
    });
    fireEvent.click(screen.getByText('保存 Key'));
    await screen.findByText('密钥已加密保存到此设备。尚未验证服务连接。');
    expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe('');
    expect(agent.mock.calls.some(([r]) => r.operation === 'select_model')).toBe(false);
    fireEvent.change(screen.getByLabelText('模型选择'), { target: { value: 'deepseek-v4-pro' } });
    fireEvent.click(screen.getByText('设为默认模型'));
    await screen.findByText('默认模型已保存：DeepSeek · deepseek-v4-pro。');
    fireEvent.click(screen.getByText('删除 Key'));
    fireEvent.click(screen.getByText('确认删除'));
    await screen.findByText('已删除本机密钥，人工编辑不受影响。');
    expect(screen.getByText('已保存')).toBeTruthy();
    expect(agent.mock.calls.some(([r]) => r.operation === 'start')).toBe(false);
  });
});
