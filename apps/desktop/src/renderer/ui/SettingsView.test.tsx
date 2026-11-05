// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRequest, AgentResponse } from '../../preload/caselite-api';
import SettingsView from './SettingsView';

afterEach(cleanup);
const response = (configured: boolean): AgentResponse => ({
  ok: true,
  configured,
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
    await screen.findByText('未配置');
    const input = screen.getByLabelText('OpenAI API Key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-' + 'synthetic-settings-test' } });
    fireEvent.click(screen.getByText('保存 Key'));
    await screen.findByRole('alert');
    expect(input.value).toBe('');
    expect(screen.queryByText('已保存')).toBeNull();
    expect((screen.getByText('删除 Key') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('重新读取状态'));
    await screen.findByText('未配置');
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
    await screen.findByText('未配置');
    expect(agent.mock.calls.filter(([r]) => r.operation === 'clear_key')).toHaveLength(1);
  });
  it('does not collect or submit credentials for preview-only services', async () => {
    const agent = vi.fn(async () => response(false));
    window.caselite = { agent } as unknown as Window['caselite'];
    show();
    await waitFor(() => expect(screen.getByText('未配置')).toBeTruthy());
    for (const name of ['DeepSeek', 'MinerU OCR', '元典']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
      expect((screen.getByLabelText(`${name} API Key`) as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByText('保存 Key') as HTMLButtonElement).disabled).toBe(true);
    }
    expect(agent).toHaveBeenCalledTimes(1);
    expect(agent).toHaveBeenCalledWith({ protocol_version: 1, operation: 'profile' });
  });
});
