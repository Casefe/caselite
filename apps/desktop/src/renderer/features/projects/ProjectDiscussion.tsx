import { useState } from 'react';
import { DiscussionFeed } from '../../shared/discussion/DiscussionFeed';
import type { Matter } from '../../../preload/caselite-api';
import { projectHealthNames } from './project-display';

export default function ProjectDiscussion({
  projectId,
  activity = false,
  archived,
  disabled,
  onDirty,
  health,
  onPublished,
}: {
  projectId: string;
  activity?: boolean;
  archived: boolean;
  disabled: boolean;
  onDirty(value: boolean): void;
  health?: Matter['health'];
  onPublished?(): void;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedHealth, setSelectedHealth] = useState<NonNullable<Matter['health']> | '' | null>(
    null,
  );
  const updateHealth = selectedHealth ?? health ?? '';
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
      <DiscussionFeed
        scope={scope}
        compose={!replyTo}
        publicationFields={activity && updateHealth ? { health: updateHealth } : undefined}
        publicationOptions={
          activity
            ? (locked) => (
                <label className="project-health-control">
                  健康度
                  <select
                    aria-label="更新健康度"
                    disabled={locked}
                    value={updateHealth}
                    onChange={(event) =>
                      setSelectedHealth(event.target.value as typeof updateHealth)
                    }
                  >
                    <option value="">{health ? '沿用当前健康度' : '未评估'}</option>
                    {Object.entries(projectHealthNames).map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            : undefined
        }
        onPublished={activity ? onPublished : undefined}
        {...props}
      >
        {activity
          ? (entry, reading) => (
              <>
                {entry.health && (
                  <span className="project-health" data-health={entry.health}>
                    {projectHealthNames[entry.health]}
                  </span>
                )}
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
