import {
  FavoriteButton,
  FavoritesProvider,
  FavoritesSidebar,
  useFavorites,
} from './features/favorites/Favorites';
import PropertyResizeHandle from './ui/PropertyResizeHandle';
import WorkspaceTopbar from './ui/WorkspaceTopbar';
import { useWorkspaceTabs } from './shared/navigation/useWorkspaceTabs';
import type { WorkspacePage } from './shared/navigation/workspace-tabs';
import { PageNavigationProvider, type ChildPage } from './shared/navigation/PageNavigation';
import CalendarView from './features/calendar/CalendarView';
import InspectorLayout from './ui/InspectorLayout';
import { DocumentPropertyValues } from './ui/DocumentInspector';
import {
  localDate,
  invalidateCalendar,
  calendarQuery,
  useCalendar,
} from './features/calendar/calendar-query';
import ContactsView from './features/contacts/ContactsView';
import { projectListDefaults } from './features/projects/ProjectList';
import ReportView from './features/reports/ReportView';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { invalidateTaskPages } from './ui/task-list-query';
import { createWorkbenchQueryClient } from './shared/data/workbench-query-client';
import {
  invalidateOrdinaryCatalog,
  invalidateProjectCatalog,
} from './shared/data/ordinary-catalog-query';
import { Icon } from './shared/ui/Icon';
import FinanceView from './features/finance/FinanceView';
import TaskCreateDialog from './features/tasks/TaskCreateDialog';
import type { TaskCalendar } from '../preload/caselite-api';
import { emptyCalendar as emptyTaskCalendar } from './shared/data/calendar-query';
import { useTaskCreationAttachments } from './features/tasks/useTaskCreationAttachments';
import type { ReminderDraft } from './features/tasks/ReminderDraftPicker';
import TaskAttachments from './ui/TaskAttachments';
import ReminderEditor from './ui/ReminderEditor';
import ReminderInbox from './ui/ReminderInbox';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  Matter,
  Task,
  TaskListQuery,
  TaskRequest,
  TaskResponse,
} from '../preload/caselite-api';
import EngineeringApp from './EngineeringApp';
import { WorkspaceShell, type WorkspaceView } from './ui/Workspace';
import ProjectCatalog, { type ProjectViewState } from './features/projects/ProjectCatalog';
import ImportantSchedules from './features/calendar/ImportantSchedules';
import DocumentLibrary from './ui/DocumentLibrary';
import TaskInspector from './ui/TaskInspector';

import SettingsView, { type SettingsSection } from './ui/SettingsView';
import { SettingsNavigation } from './shared/navigation/SettingsNavigation';
import { AppearanceProvider } from './ui/Appearance';
import RecordList, { initialTaskListState, type TaskListState } from './ui/RecordList';
import AgentHome from './ui/AgentHome';
import AgentHistory from './ui/AgentHistory';
import { emptyDraft, type RichDraft } from './editors/RichEditor';
import ActivityList from './features/projects/ActivityList';
import { DiscussionFeed } from './shared/discussion/DiscussionFeed';
import TaskContentEditor from './editors/TaskContentEditor';
import BodyEditor from './features/documents/BodyEditor';
import { mutation, check } from './shared/data/taskCommand';

type CreateTaskCommand = Extract<TaskRequest, { operation: 'create' }>;
const DeliveryPrototype = lazy(() => import('./features/documents/delivery/DeliveryPrototype'));
type SubscriptionCommand = Extract<TaskRequest, { operation: 'set_subscription' }>;
type TaskPosition = NonNullable<Extract<TaskResponse, { ok: true }>['navigation']>;
type WorkbenchPageState = {
  inspectorOpen: boolean;
  view: WorkspaceView;
  taskId?: string;
  document: boolean;
  detailTab: string;
  taskSource: ProjectViewState | null;
  taskQuery?: TaskListQuery;
  taskList: TaskListState;
  projectView: ProjectViewState | null;
  child: ChildPage | null;
  calendarDate: string;
  financeProject: string;
  settingsSection: SettingsSection;
  settingsReturn: WorkspaceView;
  scroll: Array<{ classes: string; index: number; top: number; left: number }>;
};
const workspacePages: Record<WorkspaceView, { title: string; icon: string }> = {
  home: { title: '首页', icon: 'home' },
  calendar: { title: '日历', icon: 'calendar' },
  tasks: { title: '任务', icon: 'check' },
  projects: { title: '项目', icon: 'folder' },
  documents: { title: '文档', icon: 'file' },
  knowledge: { title: '知识库', icon: 'book' },
  finance: { title: '财务', icon: 'wallet' },
  contacts: { title: '联系人', icon: 'person' },
  settings: { title: '设置', icon: 'settings' },
  reminders: { title: '提醒', icon: 'bell' },
  reports: { title: '统计', icon: 'grid' },
  tools: { title: '工具', icon: 'tool' },
  whiteboard: { title: '白板', icon: 'board' },
  'agent-history': { title: 'AI 对话历史', icon: 'clock' },
  'new-tab': { title: '新标签页', icon: 'plus' },
};

const defaultCreateProperties = {
  status: 'todo' as Task['status'],
  priority: 0,
  assignee: '本人' as string | null,
  start_date: null as string | null,
  due_date: null as string | null,
  tags: [] as string[],
  matter_id: '',
};
function FavoriteNavigation({
  tasks,
  onTask,
  onProject,
}: {
  tasks: Task[];
  onTask(id: string, document: boolean): void;
  onProject(id: string): void;
}) {
  const favorites = useFavorites();
  return (
    <FavoritesSidebar
      tasks={tasks}
      onOpen={(target) => {
        if (target.kind === 'project') {
          onProject(target.id);
          return;
        }
        const id =
          target.kind === 'document'
            ? favorites.documents.find((doc) => doc.id === target.id)?.task_id
            : target.id;
        if (id) onTask(id, target.kind === 'document');
      }}
    />
  );
}
function Workbench() {
  const queryClient = useQueryClient();
  const importantDates = useCalendar(calendarQuery('important'));
  const [settingsReturn, setSettingsReturn] = useState<WorkspaceView>('home');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [projectBackSlot, setProjectBackSlot] = useState<HTMLDivElement | null>(null);
  const [calendarDate, setCalendarDate] = useState(localDate);
  const [view, setView] = useState<WorkspaceView>('home');
  const [pageEpoch, setPageEpoch] = useState(0);
  const [inspectorChoices, setInspectorChoices] = useState<Record<string, boolean>>({});
  const displayedPage = useRef('home');
  const [initialChildState, setInitialChildState] = useState<unknown>(null);
  const childPageRead = useRef<(() => ChildPage) | null>(null);
  const captureNavigation = useRef<() => void>(() => undefined);
  const registerChildPage = useCallback((read: () => ChildPage) => {
    childPageRead.current = read;
    return () => {
      if (childPageRead.current === read) childPageRead.current = null;
    };
  }, []);
  const [childLocation, setChildLocation] = useState<Omit<ChildPage, 'state'> | null>(null);
  const reportChildLocation = useCallback((page: Omit<ChildPage, 'state'>) => {
    setChildLocation((old) => (old?.key === page.key && old.title === page.title ? old : page));
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState<RichDraft>(emptyDraft);
  const [projectView, setProjectView] = useState<ProjectViewState | null>(null);
  const [taskReturn, setTaskReturn] = useState<{ taskId: string; source: ProjectViewState } | null>(
    null,
  );
  const [taskListState, setTaskListState] = useState(initialTaskListState);
  const [taskNavigation, setTaskNavigation] = useState<{
    query: TaskListQuery;
    position: TaskPosition | null;
  } | null>(null);
  const subscriptionRequest = useRef<SubscriptionCommand | null>(null);
  const subscriptionLocked = useRef(false);
  const positionRead = useRef(0);
  const [reviewDocument, setReviewDocument] = useState<string | null>(null);
  const [reviewDock, setReviewDock] = useState<HTMLElement | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [detailTab, setDetailTab] = useState('内容');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Task | null>(null);
  const [state, setState] = useState<number[] | null>(null);
  const [creating, setCreating] = useState(false);
  const creationAttachments = useTaskCreationAttachments();
  const [creationMode, setCreationMode] = useState<'task' | 'schedule'>('task');
  const [createCalendar, setCreateCalendar] = useState<TaskCalendar>(emptyTaskCalendar);
  const [initialCreateCalendar, setInitialCreateCalendar] =
    useState<TaskCalendar>(emptyTaskCalendar);
  const createOrigin = useRef<'tasks' | 'calendar'>('tasks');
  const [createProperties, setCreateProperties] = useState(defaultCreateProperties);
  const [createTagDraft, setCreateTagDraft] = useState(false);
  const [createFieldEditing, setCreateFieldEditing] = useState(false);
  const [createReminder, setCreateReminder] = useState<ReminderDraft | null>(null);
  const [attachmentBlocked, setAttachmentBlocked] = useState(false);
  const [createSource, setCreateSource] = useState<ProjectViewState | null>(null);
  const [projectOptions, setProjectOptions] = useState<Matter[]>([]);
  const [projectOptionsState, setProjectOptionsState] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [projectOptionsAttempt, setProjectOptionsAttempt] = useState(0);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState<RichDraft>(emptyDraft);
  const [objectiveState, setObjectiveState] = useState<number[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [propertiesBlocked, setPropertiesBlocked] = useState(false);
  const [reminderBlocked, setReminderBlocked] = useState(false);
  const [commentDirty, setCommentDirty] = useState(false);
  const [financeProject, setFinanceProject] = useState('');
  const [projectDirty, setProjectDirty] = useState(false);
  const [propertiesRead, setPropertiesRead] = useState(0);
  const [error, setError] = useState('');
  const [navigationNotice, setNavigationNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const readSequence = useRef(0);
  const createRequest = useRef<CreateTaskCommand | null>(null);
  const recoveredTaskId = creationAttachments.recovered
    ? creationAttachments.draft?.task_id
    : undefined;
  useEffect(() => {
    if (!creating || !recoveredTaskId) return;
    let current = true;
    void window.caselite
      .task({ protocol_version: 1, operation: 'read', task_id: recoveredTaskId })
      .then((result) => {
        if (!current) return;
        if (!result.ok || !result.tasks[0]) {
          setError('原任务暂不可读取，请保留附件后重试。');
          return;
        }
        const task = result.tasks[0];
        setTitle(task.title);
        setObjective({ text: task.objective, state: result.objective_state ?? null });
        setCreateProperties({
          status: task.status,
          priority: task.priority,
          assignee: task.assignee ?? '本人',
          start_date: task.start_date ?? null,
          due_date: task.due_date,
          tags: task.tags ?? [],
          matter_id: task.matter_id ?? '',
        });
        setCreateCalendar(task.calendar ?? emptyTaskCalendar);
        setCreationMode(task.calendar?.schedule ? 'schedule' : 'task');
      })
      .catch(() => {
        if (current) setError('原任务暂不可读取，附件草稿已保留。');
      });
    return () => {
      current = false;
    };
  }, [creating, recoveredTaskId]);
  const listReadSequence = useRef(0);
  const refresh = useCallback(async () => {
    invalidateTaskPages(queryClient);
    invalidateCalendar(queryClient);
    void invalidateOrdinaryCatalog(queryClient, true, true);
    void invalidateProjectCatalog(queryClient);
    const sequence = ++listReadSequence.current;
    const r = check(await window.caselite.task({ operation: 'list', protocol_version: 1 }));
    if (sequence !== listReadSequence.current) return false;
    setTasks(r.tasks);
    return true;
  }, [queryClient]);
  useEffect(() => {
    void refresh()
      .catch(() => setError('任务列表读取失败，请重试；原数据没有被修改。'))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const refreshMaterials = () => {
      void refresh().catch(() => setError('材料已保存，任务列表刷新失败。'));
    };
    window.addEventListener('caselite:material-task-saved', refreshMaterials);
    return () => window.removeEventListener('caselite:material-task-saved', refreshMaterials);
  }, [refresh]);
  useEffect(() => {
    if (!creating) return;
    let current = true;
    void (async () => {
      try {
        const result = await window.caselite.catalog({ operation: 'list', protocol_version: 1 });
        if (!result.ok) throw new Error(result.message);
        if (!current) return;
        setProjectOptions(result.projects.filter((project) => !project.archived_at));
        setProjectOptionsState('ready');
      } catch {
        if (current) setProjectOptionsState('failed');
      }
    })();
    return () => {
      current = false;
    };
  }, [creating, projectOptionsAttempt]);
  const tagSuggestions = [...new Set(tasks.flatMap((task) => task.tags ?? []))];
  const createDirty =
    creating &&
    Boolean(
      title.trim() ||
      objective.state ||
      createProperties.status !== defaultCreateProperties.status ||
      createProperties.priority ||
      createProperties.assignee !== defaultCreateProperties.assignee ||
      createProperties.due_date ||
      createProperties.start_date ||
      createReminder ||
      createFieldEditing ||
      createProperties.tags.length ||
      createTagDraft ||
      creationAttachments.draft?.files.length ||
      JSON.stringify(createCalendar) !== JSON.stringify(initialCreateCalendar) ||
      createProperties.matter_id !== (createSource?.projectId ?? ''),
    );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        dirty ||
        commentDirty ||
        projectDirty ||
        propertiesBlocked ||
        reminderBlocked ||
        attachmentBlocked ||
        busy ||
        uncertain ||
        reviewSaving ||
        agentPrompt.text.trim() ||
        createDirty
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [
    dirty,
    commentDirty,
    projectDirty,
    propertiesBlocked,
    reminderBlocked,
    attachmentBlocked,
    busy,
    uncertain,
    createDirty,
    agentPrompt,
    reviewSaving,
  ]);
  function canLeave() {
    if (
      reviewSaving ||
      dirty ||
      commentDirty ||
      projectDirty ||
      propertiesBlocked ||
      reminderBlocked ||
      attachmentBlocked ||
      busy ||
      uncertain
    ) {
      setNavigationNotice('请先保存当前内容或核对提交结果，再离开当前页面。');
      return false;
    }
    if (createDirty) {
      setNavigationNotice('请先完成或取消当前新建表单。');
      return false;
    }
    setNavigationNotice('');
    return true;
  }
  function navigate(next: WorkspaceView) {
    if (!canLeave()) return;
    captureNavigation.current();
    if (view === 'projects' && next === 'settings') {
      const child = childPageRead.current?.();
      if (child?.key.startsWith('projects:')) setProjectView(child.state as ProjectViewState);
    }
    if (next !== view) {
      setInitialChildState(null);
      setChildLocation(null);
    }
    if (next === 'settings' && view !== 'settings') setSettingsReturn(view);
    readSequence.current++;
    setLoading(false);
    setView(next);
    if (next === 'finance' && view !== 'finance') setFinanceProject('');
    if (next !== 'settings') {
      setTaskReturn(null);
      setTaskNavigation(null);
    }
    if (next === 'tasks' || next === 'calendar') setActive(null);
    setCreateTagDraft(false);
    setCreating(false);
    setError('');
  }
  function newTask(source: ProjectViewState | null = null, mode: 'task' | 'schedule' = 'task') {
    if (!canLeave()) return;
    readSequence.current++;
    setLoading(false);
    setTitle('');
    setObjective(emptyDraft());
    setProjectOptionsState('loading');
    setProjectOptions([]);
    setCreateProperties({ ...defaultCreateProperties, matter_id: source?.projectId ?? '' });
    setCreateReminder(null);
    createOrigin.current = view === 'calendar' ? 'calendar' : 'tasks';
    const calendar: TaskCalendar = {
      ...emptyTaskCalendar,
      planned_date: view === 'calendar' ? calendarDate : null,
      schedule:
        mode === 'schedule'
          ? {
              date: calendarDate,
              start: '',
              end: '',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : null,
    };
    setInitialCreateCalendar(calendar);
    setCreateCalendar(calendar);
    setCreationMode(mode);
    void creationAttachments.resume();
    setCreateFieldEditing(false);
    setCreateSource(source);
    setCreating(true);
    setError('');
  }
  async function open(
    id: string,
    source: ProjectViewState | null = null,
    document = false,
    review = false,
    tab = source?.documentId || document ? '成果正文' : '内容',
    navigation: TaskListQuery | undefined = source?.projectId &&
    source.section === 'tasks' &&
    !source.documentId
      ? { ...initialTaskListState.query, scope: { type: 'project', id: source.projectId } }
      : undefined,
    adjacent = false,
    destination: WorkspaceView = 'tasks',
    restoring = false,
  ) {
    if (!canLeave()) return false;
    if (dirty) {
      setError('请先保存当前正文，再切换任务。');
      return false;
    }
    if (!restoring) captureNavigation.current();
    const seq = ++readSequence.current;
    setLoading(true);
    setError('');
    try {
      const r = check(
        await window.caselite.task({
          operation: 'read',
          protocol_version: 1,
          task_id: id,
          ...(navigation ? { navigation } : {}),
        }),
      );
      if (seq === readSequence.current) {
        const task = r.tasks[0];
        if (task?.id !== id) throw new Error('读取结果与目标任务不符，请重试。');
        if (
          source?.documentId &&
          (task.document_id !== source.documentId ||
            task.matter_id !== source.projectId ||
            task.document_archived_at)
        )
          throw new Error('文档已归档或已离开来源项目，请重新打开项目查看。');
        if (adjacent && !r.navigation)
          throw new Error('相邻任务已经离开当前视图，请返回列表重读。');
        setTaskNavigation(
          navigation ? { query: navigation, position: r.navigation ?? null } : null,
        );
        if (adjacent && !source && r.navigation) {
          const index = r.navigation.index;
          setTaskListState((current) => ({
            ...current,
            selected: id,
            scroll: 0,
            query: { ...current.query, offset: Math.floor(index / 20) * 20 },
          }));
        }
        // 只有当前读取成功才提交返回来源；迟到/失败读取不能污染下一次导航。
        setTaskReturn(source ? { taskId: id, source } : null);
        if (source) setProjectView(source);
        setActive(task);
        setReviewDocument(review ? task.document_id : null);
        setState(r.state);
        setObjectiveState(r.objective_state ?? null);
        setView(destination);
        setDetailTab(tab);
        setCreateTagDraft(false);
        setCreating(false);
        return true;
      }
    } catch (e) {
      if (seq === readSequence.current) setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      if (seq === readSequence.current) setLoading(false);
    }
    return false;
  }
  async function refreshTaskPosition(id: string) {
    if (!taskNavigation) return;
    const { query } = taskNavigation;
    const current = readSequence.current;
    const request = ++positionRead.current;
    setTaskNavigation({ query, position: null });
    try {
      const r = check(
        await window.caselite.task({
          operation: 'read',
          protocol_version: 1,
          task_id: id,
          navigation: query,
        }),
      );
      if (current === readSequence.current && request === positionRead.current && r.navigation)
        setTaskNavigation({ query, position: r.navigation });
    } catch {
      // 列表位置读失败只收起相邻入口；已确认的业务写入不重放。
    }
  }
  function openAdjacent(id: string | null) {
    if (!id || !taskNavigation) return;
    const source = taskReturn?.source;
    void open(
      id,
      source ? { ...source, returnTaskId: id } : null,
      false,
      false,
      detailTab,
      taskNavigation.query,
      true,
    );
  }
  async function setSubscription(retry = false) {
    if (
      !active ||
      subscriptionLocked.current ||
      (retry ? !subscriptionRequest.current : !canLeave())
    )
      return;
    const command = subscriptionRequest.current ?? {
      ...mutation(),
      operation: 'set_subscription' as const,
      task_id: active.id,
      expected_subscribed: Boolean(active.subscribed),
      subscribed: !active.subscribed,
    };
    subscriptionLocked.current = true;
    subscriptionRequest.current = command;
    setBusy(true);
    setError('');
    try {
      let result = retry
        ? await window.caselite.task({
            operation: 'status',
            protocol_version: 1,
            idempotency_key: command.idempotency_key,
          })
        : await window.caselite.task(command);
      if (retry && !result.ok && result.code === 'NOT_FOUND')
        result = await window.caselite.task(command);
      if (!result.ok) {
        setError(result.message);
        const unknown =
          result.code === 'RESULT_UNKNOWN' || (retry && result.code === 'READ_FAILED');
        setUncertain(unknown);
        if (!unknown) subscriptionRequest.current = null;
        return;
      }
      if (
        result.receipt !== command.idempotency_key ||
        result.tasks[0]?.id !== command.task_id ||
        result.tasks[0]?.subscribed !== command.subscribed
      )
        throw new Error('Invalid subscription receipt');
      subscriptionRequest.current = null;
      setUncertain(false);
      setActive((current) =>
        current?.id === command.task_id ? { ...current, subscribed: command.subscribed } : current,
      );
      void refreshTaskPosition(command.task_id);
      void refresh().catch(() => setError('订阅已保存，列表刷新失败，请重新打开任务列表。'));
    } catch {
      setUncertain(true);
      setError('订阅结果待核对，请使用原提交核对。');
    } finally {
      subscriptionLocked.current = false;
      setBusy(false);
    }
  }
  async function cancelCreate() {
    if (
      busy ||
      createRequest.current ||
      creationAttachments.busy ||
      creationAttachments.draft?.task_id
    )
      return;
    if (createDirty && !window.confirm('放弃尚未创建的任务和本轮附件选择？')) return;
    if (creationAttachments.draft && !(await creationAttachments.discard())) return;
    setCreateTagDraft(false);
    setCreating(false);
    setError('');
  }
  async function create(mode: 'submit' | 'retry') {
    if (
      busy ||
      createTagDraft ||
      createFieldEditing ||
      creationAttachments.busy ||
      !creationAttachments.ready ||
      (mode === 'retry' && !createRequest.current && !creationAttachments.draft?.task_id)
    )
      return;
    const recoveredTask = creationAttachments.draft?.task_id;
    if (recoveredTask && !createRequest.current) {
      setBusy(true);
      setError('');
      try {
        if (!(await creationAttachments.save(recoveredTask))) return;
        const result = check(
          await window.caselite.task({
            protocol_version: 1,
            operation: 'read',
            task_id: recoveredTask,
          }),
        );
        const saved = result.tasks.find((task) => task.id === recoveredTask);
        if (!saved) throw Error('原任务暂不可读取，请重新打开任务列表。');
        showCreated(result, saved);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '原任务暂不可读取。');
      } finally {
        setBusy(false);
      }
      return;
    }
    const original = createRequest.current;

    setBusy(true);
    setError('');
    const command = createRequest.current ?? {
      ...mutation(),
      operation: 'create' as const,
      title,
      objective: objective.text,
      status: createProperties.status,
      priority: createProperties.priority,
      assignee: createProperties.assignee,
      due_date: createProperties.due_date || null,
      start_date: createProperties.start_date || null,
      ...(createReminder ? { initial_reminder: createReminder } : {}),
      ...(creationAttachments.draft ? { creation_draft_id: creationAttachments.draft.id } : {}),
      ...(JSON.stringify(createCalendar) !== JSON.stringify(emptyTaskCalendar)
        ? { initial_calendar: createCalendar }
        : {}),
      ...(createProperties.tags.length ? { tags: createProperties.tags } : {}),
      ...(createProperties.matter_id ? { matter_id: createProperties.matter_id } : {}),
      ...(objective.state ? { objective_state: objective.state } : {}),
    };
    createRequest.current = command;
    const lookup = () =>
      window.caselite.task({
        operation: 'status',
        protocol_version: 1,
        idempotency_key: command.idempotency_key,
      });
    try {
      // 未确认的提交先查原键，仅在用户选择重试且查无回执时重发同一请求。
      let response = original ? await lookup() : await window.caselite.task(command);
      const replay = original && mode === 'retry' && !response.ok && response.code === 'NOT_FOUND';
      if (replay) response = await window.caselite.task(command);
      if ((!original || replay) && !response.ok && response.code === 'RESULT_UNKNOWN') {
        setUncertain(true);
        response = await lookup();
        if (!response.ok) throw new Error('创建结果尚未确认，请核对或重试原提交。');
      } else if (!response.ok) {
        if (
          !original ||
          (replay && (response.code === 'NOT_FOUND' || response.code === 'INVALID_REQUEST'))
        ) {
          createRequest.current = null;
          setUncertain(false);
        }
        throw new Error(response.message);
      }
      const r = check(response);
      const receiptTask = r.tasks[0];
      if (
        r.receipt !== command.idempotency_key ||
        r.tasks.length !== 1 ||
        !receiptTask ||
        receiptTask.title !== command.title.trim() ||
        receiptTask.objective !== command.objective ||
        receiptTask.status !== (command.status ?? 'todo') ||
        receiptTask.priority !== (command.priority ?? 0) ||
        (receiptTask.assignee === undefined ? '本人' : receiptTask.assignee) !==
          (command.assignee === undefined ? '本人' : command.assignee) ||
        receiptTask.due_date !== (command.due_date ?? null) ||
        JSON.stringify(receiptTask.tags ?? []) !== JSON.stringify(command.tags ?? []) ||
        receiptTask.matter_id !== (command.matter_id ?? null) ||
        (receiptTask.start_date ?? null) !== (command.start_date ?? null) ||
        (command.initial_reminder && r.reminder_created !== true) ||
        (command.initial_calendar &&
          JSON.stringify(receiptTask.calendar) !== JSON.stringify(command.initial_calendar))
      )
        throw new Error('创建回执与原提交不符，请核对原提交。');
      if (!(await creationAttachments.save(receiptTask.id)))
        throw Error('任务已创建，附件尚未全部确认保存，请继续原提交。');
      // 创建回执只证明原提交；打开详情前重读当前对象，避免恢复迟到回执时显示旧版本。
      const current = check(
        await window.caselite.task({
          protocol_version: 1,
          operation: 'read',
          task_id: receiptTask.id,
        }),
      );
      const saved = current.tasks.find(
        (t) => t.id === receiptTask.id && t.version >= receiptTask.version,
      );
      if (!saved) throw Error('任务已创建，当前版本暂时无法重读，请核对原提交。');
      showCreated(current, saved);
    } catch (e) {
      setUncertain(Boolean(createRequest.current));
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }
  function showCreated(current: Extract<TaskResponse, { ok: true }>, saved: Task) {
    setUncertain(false);
    setNavigationNotice('');
    createRequest.current = null;
    setTaskReturn(
      createSource
        ? {
            taskId: saved.id,
            source: { ...createSource, returnTaskId: saved.id },
          }
        : null,
    );
    setActive(saved);
    setReviewDocument(null);
    setTaskNavigation(null);
    setState(current.state);
    setObjectiveState(current.objective_state ?? null);
    setView(createOrigin.current);
    setDetailTab('内容');
    setCreateTagDraft(false);
    setCreating(false);
    setTitle('');
    setObjective(emptyDraft());
    void refresh().catch(() => setError('任务已创建，列表刷新失败；请重试列表，不要重复创建。'));
  }
  const resetTask = () => {
    if (!canLeave()) return;
    captureNavigation.current();
    readSequence.current++;
    setLoading(false);
    setActive(null);
    if (reviewDocument === active?.document_id) setView('documents');
    setReviewDocument(null);
    if (taskReturn && taskReturn.taskId === active?.id) {
      setProjectView(taskReturn.source);
      setView('projects');
    }
    setTaskReturn(null);
    setTaskNavigation(null);
    setError('');
  };
  const acceptTaskProperties = (saved: Task, description: number[] | null) => {
    setTasks((rows) =>
      rows.map((row) => (row.id === saved.id && row.version <= saved.version ? saved : row)),
    );
    if (active?.id === saved.id) {
      setActive(saved);
      setObjectiveState(description);
      // 属性动作只在正文/说明干净时准入；重读说明刷新其版本，普通保存ACK不重挂载编辑器。
      setPropertiesRead((epoch) => epoch + 1);
      void refreshTaskPosition(saved.id);
    }
    void refresh().catch(() => setError('任务属性已保存，列表刷新失败，请重试列表。'));
  };
  const taskInspector = active ? (
    <TaskInspector
      key={active.id}
      task={active}
      showCalendar={view === 'calendar'}
      reminder={
        <ReminderEditor
          compact
          taskId={active.id}
          disabled={
            loading ||
            dirty ||
            commentDirty ||
            projectDirty ||
            propertiesBlocked ||
            attachmentBlocked ||
            busy ||
            uncertain
          }
          onBlocked={setReminderBlocked}
          onChanged={() => setPropertiesRead((v) => v + 1)}
        />
      }
      editorAssistantDock={view === 'tasks' && detailTab === '成果正文' ? setReviewDock : undefined}
      content={
        view === 'calendar' ? (
          <div className="calendar-selected-task">
            <h2>{active.title}</h2>
            <button
              disabled={loading || propertiesBlocked || reminderBlocked || projectDirty || dirty}
              onClick={() => void open(active.id)}
            >
              打开任务内容
            </button>
          </div>
        ) : undefined
      }
      projectDisabled={
        loading ||
        dirty ||
        commentDirty ||
        propertiesBlocked ||
        reminderBlocked ||
        attachmentBlocked ||
        busy ||
        uncertain
      }
      propertiesDisabled={
        loading ||
        dirty ||
        commentDirty ||
        projectDirty ||
        reminderBlocked ||
        attachmentBlocked ||
        busy ||
        uncertain
      }
      reminderEditing={
        loading || reminderBlocked || attachmentBlocked || dirty || commentDirty || projectDirty
      }
      onPropertiesBlocked={setPropertiesBlocked}
      onTaskChanged={acceptTaskProperties}
      suggestions={tagSuggestions}
      assigneeSuggestions={tasks.flatMap(({ assignee }) => (assignee ? [assignee] : []))}
      onProjectDirty={setProjectDirty}
      onProjectChanged={acceptTaskProperties}
    />
  ) : null;
  const taskPosition = taskNavigation?.position;
  const documentEntry = reviewDocument !== null && reviewDocument === active?.document_id;
  const documentReview = documentEntry && detailTab === '成果正文';
  const childActive = ['projects', 'documents', 'knowledge'].includes(view);
  const taskPage = (view === 'tasks' || view === 'calendar') && active;
  const visibleChild =
    childActive && childLocation?.key.startsWith(view + ':') ? childLocation : null;
  const pageKey = taskPage
    ? `${view}:${taskPage.id}:${documentEntry ? 'document:' : ''}${detailTab}`
    : (visibleChild?.key ??
      (view === 'settings'
        ? `settings:${settingsSection}`
        : view === 'projects'
          ? 'projects:list'
          : view));
  const pageTitle = taskPage ? taskPage.title : (visibleChild?.title ?? workspacePages[view].title);
  const inspectorOpen =
    inspectorChoices[pageKey] ?? !(view === 'documents' && window.innerWidth <= 900);
  const initializeInspector = useCallback((key: string, open: boolean) => {
    setInspectorChoices((choices) => (key in choices ? choices : { ...choices, [key]: open }));
  }, []);
  const inspectorAvailable = [
    'home',
    'tasks',
    'projects',
    'documents',
    'knowledge',
    'finance',
    'contacts',
    'calendar',
  ].includes(view);
  const setInspectorOpen = (action: boolean | ((open: boolean) => boolean)) => {
    setInspectorChoices((choices) => ({
      ...choices,
      [pageKey]: typeof action === 'function' ? action(inspectorOpen) : action,
    }));
  };
  useLayoutEffect(() => {
    displayedPage.current = pageKey;
  }, [pageKey]);
  function capturePage(): WorkspacePage<WorkbenchPageState> {
    const child = childActive ? (childPageRead.current?.() ?? null) : null;
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>('.workspace-main, .workspace-main *'),
    );
    const counts = new Map<string, number>();
    const scroll = elements.flatMap((element) => {
      const classes = typeof element.className === 'string' ? element.className : '';
      const index = counts.get(classes) ?? 0;
      counts.set(classes, index + 1);
      return classes &&
        (element.matches('.workspace-main') || element.scrollTop || element.scrollLeft)
        ? [{ classes, index, top: element.scrollTop, left: element.scrollLeft }]
        : [];
    });
    return {
      key: pageKey,
      title: pageTitle,
      icon: taskPage
        ? documentEntry
          ? 'file'
          : 'check'
        : (visibleChild?.icon ?? workspacePages[view].icon),
      state: {
        view,
        inspectorOpen,
        ...((view === 'tasks' ||
          view === 'calendar' ||
          (view === 'settings' && (settingsReturn === 'tasks' || settingsReturn === 'calendar'))) &&
        active
          ? { taskId: active.id }
          : {}),
        document: documentEntry,
        detailTab,
        taskSource: taskReturn?.source ?? null,
        taskQuery: taskNavigation?.query,
        taskList: taskListState,
        projectView,
        child,
        calendarDate,
        financeProject,
        settingsSection,
        settingsReturn,
        scroll,
      },
    };
  }
  async function restorePage(page: WorkspacePage<WorkbenchPageState>) {
    const target = page.state;
    if (
      target.taskId &&
      !(await open(
        target.taskId,
        target.taskSource,
        target.document,
        target.document,
        target.detailTab,
        target.taskQuery,
        false,
        target.view,
        true,
      ))
    )
      return false;
    if (!target.taskId) {
      readSequence.current++;
      setActive(null);
      setReviewDocument(null);
      setState(null);
      setObjectiveState(null);
      setTaskReturn(null);
      setTaskNavigation(null);
      setView(target.view);
      setLoading(false);
    }
    setTaskListState(target.taskList);
    setProjectView(
      target.view === 'projects' && target.child
        ? (target.child.state as ProjectViewState)
        : target.projectView,
    );
    setInitialChildState(target.child?.state ?? null);
    setInspectorChoices((choices) => ({ ...choices, [page.key]: target.inspectorOpen }));
    setChildLocation(target.child);
    setCalendarDate(target.calendarDate);
    setFinanceProject(target.financeProject);
    setSettingsSection(target.settingsSection);
    setSettingsReturn(target.settingsReturn);
    setDetailTab(target.detailTab);
    setCreating(false);
    setError('');
    setPageEpoch((value) => value + 1);
    const sequence = readSequence.current;
    const frame =
      window.requestAnimationFrame ??
      ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
    frame(() =>
      frame(() => {
        // 绑定当前读取和页面；迟到的滚动恢复不能改写随后打开的工作区。
        if (sequence !== readSequence.current || displayedPage.current !== page.key) return;
        const counts = new Map<string, number>();
        document
          .querySelectorAll<HTMLElement>('.workspace-main, .workspace-main *')
          .forEach((element) => {
            const classes = typeof element.className === 'string' ? element.className : '';
            const index = counts.get(classes) ?? 0;
            counts.set(classes, index + 1);
            const saved = target.scroll.find(
              (item) => item.classes === classes && item.index === index,
            );
            if (saved) {
              element.scrollTop = saved.top;
              element.scrollLeft = saved.left;
            }
          });
      }),
    );
    return true;
  }
  const workspaceNavigation = useWorkspaceTabs({
    pageKey,
    title: pageTitle,
    getPage: capturePage,
    restore: restorePage,
    canLeave,
    ready: !loading,
    newPage: () => ({
      key: 'new-tab',
      title: '新标签页',
      icon: 'plus',
      state: {
        view: 'new-tab' as const,
        inspectorOpen: true,
        document: false,
        detailTab: '内容',
        taskSource: null,
        taskList: initialTaskListState,
        projectView: null,
        child: null,
        calendarDate: localDate(),
        financeProject: '',
        settingsSection: 'general' as const,
        settingsReturn: 'home' as const,
        scroll: [],
      },
    }),
  });
  useLayoutEffect(() => {
    captureNavigation.current = workspaceNavigation.capture;
  }, [workspaceNavigation.capture]);
  useEffect(() => {
    function onDocxSaved(event: Event) {
      if (
        view === 'tasks' &&
        detailTab === '成果正文' &&
        active?.body_revision === 0 &&
        event instanceof CustomEvent &&
        event.detail === active.id &&
        !dirty
      ) {
        void open(active.id, taskReturn?.source, true, documentEntry);
      }
    }
    window.addEventListener('caselite:docx-draft-saved', onDocxSaved);
    return () => window.removeEventListener('caselite:docx-draft-saved', onDocxSaved);
  });
  return (
    <SettingsNavigation
      openEditor={() => {
        if (!canLeave()) return;
        setSettingsSection('editor');
        navigate('settings');
      }}
      openModels={() => {
        if (!canLeave()) return;
        setSettingsSection('models');
        navigate('settings');
      }}
    >
      <WorkspaceShell
        view={view === 'tasks' && documentEntry ? 'documents' : view}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(!collapsed)}
        onNavigate={navigate}
        inspectorOpen={inspectorOpen}
        topbar={
          <WorkspaceTopbar
            navigation={workspaceNavigation}
            collapsed={collapsed}
            onCollapse={() => setCollapsed(!collapsed)}
            inspectorOpen={inspectorOpen}
            inspectorAvailable={inspectorAvailable}
            onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
          />
        }
        projectBackSlot={setProjectBackSlot}
        tasks={tasks}
        importantDatesCount={importantDates.isError ? undefined : importantDates.data?.page?.total}
        favoritesPanel={
          <FavoriteNavigation
            tasks={tasks}
            onTask={(id, document) => void open(id, null, document, document)}
            onProject={(id) => {
              if (!canLeave()) return;
              setProjectView({
                selected: id,
                projectId: id,
                section: 'overview',
                query: '',
                statusFilter: 'all',
                order: 'updated',
                columns: projectListDefaults,
                scrollTop: 0,
                workspaceScrollTop: 0,
                returnTaskId: '',
              });
              navigate('projects');
            }}
          />
        }
        agentDraft={Boolean(agentPrompt.text.trim())}
        onOpen={(id) => void open(id)}
      >
        {navigationNotice &&
          !creating &&
          (reviewSaving ||
            dirty ||
            commentDirty ||
            projectDirty ||
            propertiesBlocked ||
            reminderBlocked ||
            attachmentBlocked ||
            busy ||
            uncertain) && (
            <div className="error" role="alert">
              {navigationNotice}
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => setNavigationNotice('')}
              >
                ×
              </button>
            </div>
          )}
        {error && !creating && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => void refresh().catch(() => setError('读取仍失败，请检查本地存储。'))}
            >
              重试列表
            </button>
            <button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {creating && (
          <TaskCreateDialog
            mode={creationMode}
            calendar={createCalendar}
            onCalendar={setCreateCalendar}
            attachments={creationAttachments}
            title={title}
            onTitle={setTitle}
            objective={objective}
            onObjective={setObjective}
            properties={createProperties}
            onProperties={setCreateProperties}
            reminder={createReminder}
            onReminder={setCreateReminder}
            projects={projectOptions}
            projectState={projectOptionsState}
            onRetryProjects={() => {
              setProjectOptionsState('loading');
              setProjectOptions([]);
              setProjectOptionsAttempt((n) => n + 1);
            }}
            suggestions={tagSuggestions}
            assigneeSuggestions={tasks.flatMap((t) => (t.assignee ? [t.assignee] : []))}
            onTagDraft={setCreateTagDraft}
            onFieldEditing={setCreateFieldEditing}
            busy={busy}
            uncertain={uncertain}
            error={error || navigationNotice}
            onCancel={cancelCreate}
            onCreate={() => void create('submit')}
            onRetry={() => void create('retry')}
          />
        )}
        <PageNavigationProvider
          value={{
            initial: initialChildState,
            register: registerChildPage,
            report: reportChildLocation,
            beforeChange: workspaceNavigation.capture,
            inspector: {
              open: inspectorOpen,
              setOpen: setInspectorOpen,
              pageKey,
              initialize: initializeInspector,
            },
          }}
          key={`${view}:${pageEpoch}`}
        >
          {view === 'new-tab' ? (
            <section className="workspace-new-page">
              <h1>打开一个页面</h1>
              <div className="workspace-new-page-links">
                {(
                  [
                    'home',
                    'tasks',
                    'projects',
                    'documents',
                    'calendar',
                    'finance',
                    'contacts',
                  ] as const
                ).map((next) => (
                  <button key={next} type="button" onClick={() => navigate(next)}>
                    <Icon name={workspacePages[next].icon} />
                    <span>{workspacePages[next].title}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : loading && view !== 'projects' && view !== 'calendar' ? (
            <div className="loading-state" role="status">
              正在读取本地任务…
            </div>
          ) : view === 'projects' ? (
            <ProjectCatalog
              favoriteAction={(project, disabled) => (
                <FavoriteButton kind="project" id={project.id} disabled={disabled} />
              )}
              tasks={tasks}
              initialView={projectView}
              backSlot={projectBackSlot}
              navigationPending={loading}
              onOpen={(id, source) => void open(id, source)}
              onNewTask={newTask}
              onCalendar={() => navigate('calendar')}
              importantInfo={ImportantSchedules}
              onFinance={(projectId) => {
                if (!canLeave()) return;
                navigate('finance');
                setFinanceProject(projectId);
              }}
              onDirty={setDirty}
              onChanged={async () => {
                try {
                  return await refresh();
                } catch {
                  setError('数据已保存，任务列表刷新失败，请重新读取。');
                  return false;
                }
              }}
            />
          ) : view === 'calendar' ? (
            <CalendarView
              onCreate={(mode) => newTask(null, mode)}
              date={calendarDate}
              selected={active}
              inspector={taskInspector}
              blocked={
                loading ||
                dirty ||
                propertiesBlocked ||
                reminderBlocked ||
                attachmentBlocked ||
                projectDirty ||
                busy ||
                uncertain
              }
              onOpen={(id) =>
                void open(id, null, false, false, '内容', undefined, false, 'calendar')
              }
              onClose={() => {
                if (canLeave()) {
                  readSequence.current++;
                  setActive(null);
                }
              }}
              onDate={(date) => {
                if (canLeave()) {
                  readSequence.current++;
                  setCalendarDate(date);
                  setActive(null);
                }
              }}
              onReminders={() => navigate('reminders')}
              onSettings={() => {
                if (canLeave()) {
                  setSettingsSection('integrations');
                  navigate('settings');
                }
              }}
            />
          ) : view === 'home' ? (
            <AgentHome
              prompt={agentPrompt}
              onPrompt={setAgentPrompt}
              onNavigate={navigate}
              tasks={tasks}
              onOpen={(id) => void open(id)}
            />
          ) : view === 'agent-history' ? (
            <AgentHistory
              tasks={tasks}
              onBack={() => navigate('home')}
              onOpen={(id) => void open(id)}
            />
          ) : view === 'tasks' && active ? (
            <section
              className="task-detail"
              data-layout="three-column"
              data-active-task={active.id}
              data-task-tab={detailTab === '内容' ? 'content' : undefined}
            >
              <div className="page-topline task-detail-topline">
                <div>
                  <button
                    className="icon-button"
                    aria-label={
                      documentEntry
                        ? '返回文档列表'
                        : taskReturn?.taskId === active.id
                          ? '返回来源项目'
                          : '返回任务列表'
                    }
                    data-testid="back-to-tasks"
                    onClick={resetTask}
                  >
                    <Icon name="back" size={16} />
                  </button>
                  <button className="breadcrumb-button" onClick={resetTask}>
                    {documentEntry
                      ? '文档'
                      : taskReturn?.taskId === active.id
                        ? '来源项目'
                        : '任务'}
                  </button>
                  <Icon name="chevron" size={13} />
                  {active.matter_title && (
                    <>
                      <span data-testid="task-project-context">{active.matter_title}</span>
                      <Icon name="chevron" size={13} />
                    </>
                  )}
                  <span className="task-breadcrumb-title" title={active.title}>
                    {active.title}
                  </span>
                  <FavoriteButton
                    kind={documentEntry ? 'document' : 'task'}
                    id={documentEntry ? active.document_id : active.id}
                    disabled={busy || uncertain}
                  />
                </div>
                {taskPosition && (
                  <div className="task-adjacent" role="group" aria-label="任务列表顺序">
                    <span>
                      {taskPosition.index + 1} / {taskPosition.total}
                    </span>
                    <button
                      type="button"
                      aria-label="上一项"
                      disabled={!taskPosition.previous}
                      onClick={() => openAdjacent(taskPosition.previous)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="下一项"
                      disabled={!taskPosition.next}
                      onClick={() => openAdjacent(taskPosition.next)}
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>

              <div className="task-layout property-resizable" data-properties-resizable="true">
                <PropertyResizeHandle module="tasks" />
                <div className="task-work-area" aria-label="阅读与编辑工作区">
                  <div className="task-reminder-entry">
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={Boolean(active.subscribed)}
                      onClick={() => void setSubscription(uncertain)}
                    >
                      {uncertain ? '核对订阅提交' : active.subscribed ? '取消订阅' : '订阅任务'}
                    </button>
                  </div>
                  <div className="project-tabs detail-tabs" role="tablist" aria-label="任务栏目">
                    {['内容', '成果正文', '材料'].map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={detailTab === t}
                        data-testid={t === '成果正文' ? 'task-result-tab' : undefined}
                        onClick={() => {
                          if (detailTab === t || !canLeave()) return;
                          // 空正文可能已从材料侧栏初始化，首次打开须读取已确认的修订。
                          if (t === '成果正文' && active.body_revision === 0) {
                            void open(active.id, taskReturn?.source, true, documentEntry);
                          } else setDetailTab(t);
                        }}
                      >
                        {t === '材料' ? '材料阅读' : t}
                        {t === '成果正文' && <small>1</small>}
                      </button>
                    ))}
                  </div>

                  <div className="task-title" hidden={detailTab === '内容'}>
                    <div>
                      <h1>{active.title}</h1>
                    </div>
                  </div>
                  {detailTab === '成果正文' ? (
                    <BodyEditor
                      key={active.body_id}
                      task={active}
                      initial={state}
                      onDirty={setDirty}
                      reviewDock={reviewDock}
                      reviewVariant={documentReview ? 'review' : 'assistant'}
                      reviewSaving={reviewSaving}
                      onReviewSaving={setReviewSaving}
                      disabled={
                        projectDirty || propertiesBlocked || reminderBlocked || attachmentBlocked
                      }
                      onSaved={(t, savedState) => {
                        setActive(t);
                        setState(savedState);
                        void refreshTaskPosition(t.id);
                        void refresh().catch(() => setError('正文已保存，列表刷新失败。'));
                      }}
                    />
                  ) : detailTab === '内容' ? (
                    <div className="task-content-overview" key={active.id}>
                      <TaskContentEditor
                        key={active.id + ':' + propertiesRead}
                        task={active}
                        initial={objectiveState}
                        onDirty={setDirty}
                        disabled={
                          commentDirty ||
                          projectDirty ||
                          propertiesBlocked ||
                          reminderBlocked ||
                          attachmentBlocked
                        }
                        onSaved={(saved, bytes) => {
                          setActive(saved);
                          setObjectiveState(bytes);
                          void refreshTaskPosition(saved.id);
                          void refresh().catch(() => setError('任务内容已保存，列表刷新失败。'));
                        }}
                      />
                      <TaskAttachments
                        key={`attachments:${active.id}`}
                        taskId={active.id}
                        task={active}
                        disabled={
                          dirty ||
                          commentDirty ||
                          projectDirty ||
                          propertiesBlocked ||
                          reminderBlocked
                        }
                        onDateBlocked={setAttachmentBlocked}
                        onTaskChanged={acceptTaskProperties}
                      />
                      <section className="task-detail-section task-events">
                        <h2>活动与评论</h2>
                        <ActivityList
                          scope={{ type: 'task', id: active.id }}
                          refresh={
                            String(active.version) +
                            ':' +
                            active.body_revision +
                            ':' +
                            propertiesRead
                          }
                          disabled={
                            dirty ||
                            commentDirty ||
                            projectDirty ||
                            propertiesBlocked ||
                            reminderBlocked
                          }
                          onTask={(id) => void open(id, taskReturn?.source)}
                          compact
                          readOnly
                        />
                      </section>
                      <section className="task-detail-section project-discussion" aria-label="评论">
                        <h2 className="sr-only">评论</h2>
                        <DiscussionFeed
                          scope={{ kind: 'task_comment', task_id: active.id }}
                          composerPosition="end"
                          refresh={active.matter_id}
                          archived={false}
                          disabled={dirty || projectDirty || propertiesBlocked || reminderBlocked}
                          onDirty={setCommentDirty}
                          compose
                        />
                      </section>
                    </div>
                  ) : (
                    <TaskAttachments
                      key={`materials:${active.id}`}
                      taskId={active.id}
                      task={active}
                      disabled={
                        dirty ||
                        commentDirty ||
                        projectDirty ||
                        propertiesBlocked ||
                        reminderBlocked
                      }
                      onDateBlocked={setAttachmentBlocked}
                      onTaskChanged={acceptTaskProperties}
                    />
                  )}
                </div>
                {documentReview ? (
                  <aside className="task-inspector" aria-label="文档审阅侧栏">
                    <InspectorLayout
                      properties={
                        <div
                          className="inspector-content task-inspector-content"
                          aria-label="文档属性"
                        >
                          <DocumentPropertyValues
                            revision={active.body_revision}
                            projectTitle={
                              active.matter_title ?? (active.matter_id ? '已归组' : '未归组')
                            }
                            taskTitle={active.title}
                            documentId={active.document_id}
                          />
                        </div>
                      }
                    >
                      <div ref={setReviewDock} aria-label="正文 AI 侧栏" />
                    </InspectorLayout>
                  </aside>
                ) : (
                  taskInspector
                )}
              </div>
            </section>
          ) : view === 'reminders' ? (
            <>
              <button onClick={() => navigate('calendar')}>返回日历</button>
              <ReminderInbox onOpen={(id) => void open(id)} onBlocked={setPropertiesBlocked} />
            </>
          ) : view === 'documents' || view === 'knowledge' ? (
            <DocumentLibrary
              key={view}
              library={view === 'knowledge'}
              onOpen={(id) => void open(id, null, true, view === 'documents')}
              onDirty={setDirty}
            />
          ) : view === 'tasks' ? (
            <RecordList
              key={view}
              tasks={tasks}
              viewState={taskListState}
              onViewState={setTaskListState}
              onOpen={(id, navigation) => void open(id, null, false, false, '内容', navigation)}
              onNew={() => newTask()}
              propertiesBlocked={propertiesBlocked}
              projectDirty={projectDirty}
              onProjectDirty={setProjectDirty}
              onPropertiesBlocked={setPropertiesBlocked}
              onTaskChanged={acceptTaskProperties}
            />
          ) : view === 'contacts' ? (
            <ContactsView
              onOpenFinance={(id) => {
                if (!canLeave()) return;
                navigate('finance');
                setFinanceProject(id);
              }}
              onDirty={setDirty}
              onOpenTask={(id) => void open(id)}
              onOpenDocument={(_id, taskId) => void open(taskId, null, true)}
              onOpenProject={(id) => {
                if (!canLeave()) return;
                setProjectView({
                  selected: id,
                  projectId: id,
                  section: 'overview',
                  query: '',
                  statusFilter: 'all',
                  order: 'updated',
                  columns: projectListDefaults,
                  scrollTop: 0,
                  workspaceScrollTop: 0,
                  returnTaskId: '',
                });
                navigate('projects');
              }}
            />
          ) : view === 'reports' ? (
            <ReportView
              tasks={tasks}
              onFinance={(id) => {
                navigate('finance');
                setFinanceProject(id);
              }}
            />
          ) : view === 'finance' ? (
            <FinanceView initialProject={financeProject} onDirty={setDirty} />
          ) : view === 'tools' || view === 'whiteboard' ? (
            <section className="workspace-placeholder">
              <h1>{{ tools: '工具', whiteboard: '白板' }[view]}</h1>
              <div className="table-empty">
                {{ tools: '这里还没有可用工具。', whiteboard: '这里还没有白板。' }[view]}
              </div>
            </section>
          ) : view === 'settings' ? (
            <SettingsView
              section={settingsSection}
              onSection={(section) => {
                if (canLeave()) setSettingsSection(section);
              }}
              onBlocked={setPropertiesBlocked}
              onBack={() => {
                if (settingsReturn === 'tasks' && active)
                  void open(
                    active.id,
                    taskReturn?.taskId === active.id ? taskReturn.source : null,
                    documentEntry,
                    documentEntry,
                    detailTab,
                  );
                else navigate(settingsReturn);
              }}
            />
          ) : (
            <div>请选择导航入口。</div>
          )}
        </PageNavigationProvider>
      </WorkspaceShell>
    </SettingsNavigation>
  );
}
export default function App() {
  const [queryClient] = useState(createWorkbenchQueryClient);
  return new URLSearchParams(window.location.search).has('engineering') ? (
    <EngineeringApp />
  ) : (
    <AppearanceProvider>
      <QueryClientProvider client={queryClient}>
        {new URLSearchParams(window.location.search).has('delivery-preview') ? (
          <Suspense fallback={<p role="status">正在载入交付界面原型…</p>}>
            <DeliveryPrototype />
          </Suspense>
        ) : (
          <FavoritesProvider>
            <Workbench />
          </FavoritesProvider>
        )}
      </QueryClientProvider>
    </AppearanceProvider>
  );
}
