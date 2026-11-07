import { useState } from 'react';
import { DiscussionFeed } from '../../shared/discussion/DiscussionFeed';

export default function ProjectDiscussion({
  projectId,
  activity = false,
  archived,
  disabled,
  onDirty,
}: {
  projectId: string;
  activity?: boolean;
  archived: boolean;
  disabled: boolean;
  onDirty(value: boolean): void;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const scope = { kind: activity ? 'update' : 'project_comment', project_id: projectId } as const;
  const reportDirty = (value: boolean) => {
    setDirty(value);
    onDirty(value);
  };
  const props = { archived, disabled, onDirty: reportDirty };
  return (
    <section
      className="project-record-panel project-discussion"
      aria-label={activity ? '项目更新' : '项目评论'}
    >
      <h2>{activity ? '人工项目更新' : '项目整体评论'}</h2>
      <DiscussionFeed scope={scope} compose={!replyTo} {...props}>
        {activity
          ? (entry, reading) => (
              <>
                <button
                  type="button"
                  disabled={disabled || dirty || reading}
                  aria-expanded={replyTo === entry.id}
                  onClick={() => setReplyTo(replyTo === entry.id ? null : entry.id)}
                >
                  {replyTo === entry.id ? '收起讨论' : '查看与评论更新'}
                </button>
                {replyTo === entry.id && (
                  <DiscussionFeed
                    key={entry.id}
                    scope={{ kind: 'update_comment', project_id: projectId, update_id: entry.id }}
                    compose
                    {...props}
                  />
                )}
              </>
            )
          : undefined}
      </DiscussionFeed>
    </section>
  );
}
