import type { Task } from '../../preload/caselite-api';
import { taskPriorityNames } from './task-priority';
import { taskStatusNames } from './task-status';

export function PriorityGlyph({ priority }: { priority: Task['priority'] }) {
  const label = taskPriorityNames[priority];
  return (
    <span className="work-list-glyph" data-priority={priority} title={label}>
      <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={label}>
        {priority === 0 ? (
          <path d="M2 8h2m3 0h2m3 0h2" stroke="currentColor" strokeLinecap="round" />
        ) : (
          [4, 7, 10].map((height, index) => (
            <rect
              key={height}
              x={2 + index * 4}
              y={13 - height}
              width="2.5"
              height={height}
              rx="0.8"
              fill="currentColor"
              opacity={index < (priority === 1 ? 3 : 5 - priority) ? 1 : 0.3}
            />
          ))
        )}
      </svg>
    </span>
  );
}

export function StatusGlyph({ status }: { status: Task['status'] }) {
  const label = taskStatusNames[status];
  return (
    <span className="work-list-glyph" data-status={status} title={label}>
      <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={label}>
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        {status === 'in_progress' && <path d="M8 4a4 4 0 0 1 0 8Z" fill="currentColor" />}
        {status === 'done' && (
          <path d="m5.4 8 1.8 1.8 3.4-3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
        {status === 'canceled' && <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.5" />}
      </svg>
    </span>
  );
}
