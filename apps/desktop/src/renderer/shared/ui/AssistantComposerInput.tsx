import { ComposerPrimitive } from '@assistant-ui/react';
import { forwardRef, useId, type ComponentProps } from 'react';

type Props = ComponentProps<typeof ComposerPrimitive.Input> & { textLength: number };

export const AssistantComposerInput = forwardRef<HTMLTextAreaElement, Props>(
  function AssistantComposerInput({ textLength, ...props }, ref) {
    const limitId = useId();
    const overLimit = textLength > 4000;
    return (
      <>
        <ComposerPrimitive.Input
          {...props}
          ref={ref}
          aria-invalid={overLimit || undefined}
          aria-describedby={overLimit ? limitId : undefined}
        />
        {overLimit && (
          <p id={limitId} className="assistant-input-limit" role="alert">
            输入最多 4000 字符，当前 {textLength} 字符。请精简后发送，全部输入已保留。
          </p>
        )}
      </>
    );
  },
);
