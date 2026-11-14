import { AssistantComposerInput } from '../../../shared/ui/AssistantComposerInput';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useAuiState,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useEffect, useRef } from 'react';
import { useAui } from '@assistant-ui/react';
import AgentQuickActions from '../../../shared/ui/AgentQuickActions';

function Input({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  const aui = useAui();
  const composerText = useAuiState((state) => state.composer.text);
  useEffect(() => {
    if (aui.composer.getState().text !== value) aui.composer.setText(value);
  }, [aui, value, composerText]);
  return (
    <AssistantComposerInput
      textLength={value.length}
      aria-label="本轮问题"
      placeholder="询问 Caselite AI"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      maxLength={4000}
      rows={1}
      addAttachmentOnPaste={false}
    />
  );
}
function Message() {
  return (
    <MessagePrimitive.Root className="editor-agent-message">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

// assistant-ui 仅投影已有审阅状态；模型、运行和保存继续由同一 Application 拥有。
export default function EditorConversation({
  messages,
  question,
  onQuestion,
  send,
  stop,
  running,
  disabled,
}: {
  messages: ThreadMessageLike[];
  question: string;
  onQuestion(value: string): void;
  send(): void;
  stop(): void;
  running: boolean;
  disabled: boolean;
}) {
  const thread = useRef<HTMLDivElement>(null);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (m) => m,
    isRunning: running,
    onNew: async () => {
      if (disabled || running || !question.trim() || question.length > 4000) return;
      send();
    },
    onCancel: async () => {
      stop();
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root ref={thread} className="editor-agent-thread">
        <ThreadPrimitive.Viewport className="editor-agent-viewport">
          <ThreadPrimitive.Messages components={{ Message }} />
        </ThreadPrimitive.Viewport>
        <AgentQuickActions
          kind="document"
          disabled={disabled || running}
          onSelect={(prompt) => {
            onQuestion(question.length ? `${question}\n${prompt}` : prompt);
            thread.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
          }}
        />
        <ComposerPrimitive.Root>
          <Input value={question} onChange={onQuestion} disabled={disabled || running} />
          <ComposerPrimitive.Send
            data-sidebar-expand
            disabled={disabled || running || !question.trim() || question.length > 4000}
          >
            发送本轮审阅
          </ComposerPrimitive.Send>
          {running && <ComposerPrimitive.Cancel>停止</ComposerPrimitive.Cancel>}
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
