import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { AgentModel, AgentRequest, AgentRun } from '../../../../preload/caselite-api';

export type DocumentScope = `document:${string}`;
export type ReviewSend = { id: string; model: AgentModel };
const protocol_version = 1 as const;

export function documentReviewTransport(
  scope: DocumentScope,
  onTerminal: (run: AgentRun) => void,
): ChatTransport<UIMessage> {
  return {
    async reconnectToStream() {
      return null;
    },
    async sendMessages({ trigger, messages, body, abortSignal }) {
      const options = body as ReviewSend | undefined;
      const last = messages.at(-1);
      const part = last?.parts[0];
      if (
        trigger !== 'submit-message' ||
        !options ||
        last?.role !== 'user' ||
        last.parts.length !== 1 ||
        part?.type !== 'text' ||
        abortSignal?.aborted
      )
        throw new Error('请先核对选区，再明确发送。');
      const { id: run_id, model } = options;
      const prompt = part.text;
      const request = (input: AgentRequest) => window.caselite.agent(input);
      let cancelled: Promise<unknown> | undefined;
      const cancel = () =>
        (cancelled ??= request({ protocol_version, scope, run_id, operation: 'cancel' }).catch(
          () => {},
        ));
      let disposed = false;
      let registered = false;
      let finished = false;
      let readerCancelled = false;
      const stop = () => {
        disposed = true;
        if (registered && !finished) void cancel();
      };
      return new ReadableStream<UIMessageChunk>({
        cancel() {
          readerCancelled = true;
          stop();
        },
        start(controller) {
          abortSignal?.addEventListener('abort', stop, { once: true });
          const id = run_id;
          async function pump() {
            try {
              if (abortSignal?.aborted) return;
              let response = await request({
                protocol_version,
                operation: 'start',
                confirmed: true,
                scope,
                run_id,
                context_id: run_id,
                model,
                prompt,
              });
              // 取消可能先于登记回执。先收敛同一 Run，再丢弃所有迟到文本。
              registered = response.ok;
              if (disposed || abortSignal?.aborted) return;
              controller.enqueue({ type: 'start' });
              controller.enqueue({ type: 'text-start', id });
              let output = '';
              while (!disposed && !abortSignal?.aborted) {
                if (!response.ok) throw new Error(response.message);
                const run = response.runs.find((entry) => entry.id === run_id);
                if (!run) throw new Error('本地运行回执暂不可用。');
                if (!run.output.startsWith(output))
                  throw new Error('流式输出已变化，请核对本地记录。');
                const delta = run.output.slice(output.length);
                output = run.output;
                if (delta) controller.enqueue({ type: 'text-delta', id, delta });
                if (run.status !== 'running') {
                  finished = true;
                  if (run.status !== 'succeeded') throw new Error(run.message || '审阅未完成。');
                  controller.enqueue({ type: 'text-end', id });
                  controller.enqueue({ type: 'finish', finishReason: 'stop' });
                  onTerminal(run);
                  break;
                }
                await new Promise<void>((resolve) => setTimeout(resolve, 100));
                if (disposed || abortSignal?.aborted) break;
                response = await request({ protocol_version, operation: 'read', scope });
              }
            } catch (error) {
              if (!disposed && !abortSignal?.aborted)
                controller.enqueue({
                  type: 'error',
                  errorText:
                    error instanceof Error ? error.message : '审阅运行失败，请核对本地记录。',
                });
            } finally {
              abortSignal?.removeEventListener('abort', stop);
              if (!finished) await cancel();
              if (!readerCancelled) controller.close();
            }
          }
          void pump();
        },
      });
    },
  };
}
