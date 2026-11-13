import { DailyWorkload } from "./DailyWorkload";
import { usePanelMemory, RememberedScrollView } from "./panel-memory";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type CompletionReceipt,
  type Task,
  tasksAddRpc,
  tasksCompleteRpc,
  tasksListRpc,
  tasksRefreshSignalRpc,
  tasksRemovePlanRpc,
  tasksEvaOpenRpc,
} from "../shared/contracts";
import { buildCompletionReceipt, visibleNotificationDescription } from "../shared/feedback";
import {
  type AgendaItem,
  buildAgenda,
  buildSections,
  formatScheduleTag,
  parseUserDateTime,
  planDisplayName,
} from "./model";
import { makeStyles, type Styles } from "./styles";
import { BookReadingCard } from "./BookReadingCard";
import { MusicBeeBar } from "./MusicBeeBar";
import { TaskActionsModal } from "./TaskActionsModal";
import { openExternal } from "./web";

const TASKS_KEY = ["notion-tasks", "tasks"];

export function TasksSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [bookExpanded, setBookExpanded] = usePanelMemory("book:expanded-panel", false);
  const listTasks = useRpc(tasksListRpc);
  const tasksQuery = useQuery({ queryKey: TASKS_KEY, queryFn: () => listTasks({}), refetchInterval: 60_000, refetchOnMount: false, gcTime: Infinity });
  const [receipt, setReceipt] = useState<CompletionReceipt | null>(null);
  const [actionTask, setActionTask] = useState<Task | null>(null);
  // Completed rows vanish immediately instead of waiting for Notion's next query.
  const [hiddenIds, setHiddenIds] = useState<Record<string, number>>({});

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
  };
  // Poll the cheap trigger-file signal and reload when a script changed Notion.
  const readSignal = useRpc(tasksRefreshSignalRpc);
  const signalQuery = useQuery({ queryKey: ["notion-tasks", "signal"], queryFn: () => readSignal({}), refetchInterval: 5_000 });
  const lastSignal = useRef<string | undefined>(undefined);
  useEffect(() => {
    const signal = signalQuery.data?.signal;
    if (signal === undefined) return;
    if (lastSignal.current !== undefined && lastSignal.current !== signal) refreshAll();
    lastSignal.current = signal;
  }, [signalQuery.data?.signal]);
  const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error));

  const completeRpc = useRpc(tasksCompleteRpc);
  const [completingId, setCompletingId] = useState("");
  const complete = useMutation({
    mutationFn: (task: Task) => completeRpc({ id: task.id, name: task.name }),
    onMutate: (task) => setCompletingId(task.id),
    onSuccess: (result) => {
      setHiddenIds((current) => ({ ...current, [result.taskId]: Date.now() }));
      if (result.source !== "notification") setReceipt(result);
      refreshAll();
    },
    onError: (error) => toast.error(`没有完成：${error instanceof Error ? error.message : String(error)}`),
    onSettled: () => setCompletingId(""),
  });

  const evaOpenRpc = useRpc(tasksEvaOpenRpc);
  const [evaOpeningId, setEvaOpeningId] = useState("");
  // Opens the session associated with this notification.
  const openEva = useMutation({
    mutationFn: async (task: Task) => {
      setEvaOpeningId(task.id);
      return evaOpenRpc({ id: task.id });
    },
    onSuccess: ({ agentId }) => navigation?.openAgent({ agentId }),
    onError: reportError,
    onSettled: () => setEvaOpeningId(""),
  });
  const removePlanRpc = useRpc(tasksRemovePlanRpc);
  const removePlan = useMutation({
    mutationFn: (input: { id: string; plan: string }) => removePlanRpc(input),
    onSuccess: refreshAll,
    onError: reportError,
  });

  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => setReceipt(null), 8000);
    return () => clearTimeout(timer);
  }, [receipt]);

  const data = tasksQuery.data;
  const visibleTasks = useMemo(() => {
    const cutoff = Date.now() - 30_000;
    return (data?.tasks || []).filter((task) => !(hiddenIds[task.id] > cutoff));
  }, [data, hiddenIds]);
  // Re-render every minute so "soon"/"overdue" colors and day labels stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const sections = useMemo(
    () => (data ? buildSections(visibleTasks, data.planTags, data.groupTags) : []),
    [data, visibleTasks],
  );

  const topContent = (<>
      <DailyWorkload theme={theme} />
      <CalendarPanel styles={styles} tasks={visibleTasks} now={now} onPick={setActionTask} />
      {receipt ? <ReceiptCard styles={styles} receipt={receipt} onDismiss={() => setReceipt(null)} /> : null}
      <AddRow styles={styles} tags={data?.tags || []} onAdded={refreshAll} onError={reportError} />
  </>);
  const taskContent = (<>
        {tasksQuery.isPending ? <Text style={styles.muted}>正在加载...</Text> : null}
        {tasksQuery.isError ? <Text style={styles.error}>加载失败：{String(tasksQuery.error?.message || tasksQuery.error)}</Text> : null}
        {sections.map((section, index) => (
          <View key={section.key} style={styles.section}>
            {section.plan ? (
              // Plan lanes are separated by a bare line; the first needs none.
              index > 0 ? <View accessible accessibilityLabel={section.title} style={styles.planLine} /> : null
            ) : (
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{section.title}</Text>
                <Text style={styles.groupCount}>{section.tasks.length}</Text>
              </View>
            )}
            {section.tasks.map((task) => (
              <TaskRow key={task.id} styles={styles} task={task} planContext={section.plan}
                completing={completingId === task.id}
                onComplete={() => complete.mutate(task)}
                onRemovePlan={() => removePlan.mutate({ id: task.id, plan: section.plan })}
                onOpen={() => setActionTask(task)}
                evaOpening={evaOpeningId === task.id}
                onEva={navigation ? () => openEva.mutate(task) : undefined} />
            ))}
          </View>
        ))}
  </>);

  return (
    <View style={[styles.screen, layout.platform !== "web" && { paddingTop: 0, minHeight: 0 }]}>
      {layout.platform === "web" ? <MusicBeeBar theme={theme} /> : null}
      <BookReadingCard styles={styles} fillAvailableSpace={layout.platform !== "web"} onExpandedChange={setBookExpanded} />
      {layout.platform !== "web" ? (
        <RememberedScrollView memoryKey="tasks-native" style={[styles.list, { minHeight: 0 }, bookExpanded && { display: "none" }]} keyboardShouldPersistTaps="handled">
          {topContent}
          <View style={styles.listContent}>{taskContent}</View>
        </RememberedScrollView>
      ) : (
        <>
          {topContent}
          <RememberedScrollView memoryKey="tasks-web" style={styles.list} contentContainerStyle={styles.listContent}>
            {taskContent}
          </RememberedScrollView>
        </>
      )}
      <TaskActionsModal styles={styles} task={actionTask} tags={data?.tags || []} planTags={data?.planTags || []}
        onClose={() => setActionTask(null)} onChanged={refreshAll} onError={reportError} />
    </View>
  );
}

function ReceiptCard({ styles, receipt, onDismiss }: { styles: Styles; receipt: CompletionReceipt; onDismiss(): void }) {
  const view = buildCompletionReceipt(receipt);
  return (
    <View style={styles.receipt}>
      <Text style={styles.receiptIcon}>✓</Text>
      <View style={styles.receiptBody}>
        <Text style={styles.receiptKicker}>{view.kicker}</Text>
        <Text style={styles.receiptTitle}>{view.title}</Text>
        {view.details.map((line) => <Text key={line} style={styles.receiptDetail}>{line}</Text>)}
        {view.next ? <Text style={styles.receiptNext}>{view.next}</Text> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="收起成果回执" onPress={onDismiss} style={styles.iconButton}>
        <Text style={styles.iconText}>×</Text>
      </Pressable>
    </View>
  );
}

function AddRow({ styles, tags, onAdded, onError }: {
  styles: Styles;
  tags: string[];
  onAdded(): void;
  onError(error: unknown): void;
}) {
  const [tagIndex, setTagIndex] = useState(1); // 正事, the Cursor sidebar default after 优先
  const [name, setName] = usePanelMemory("add:name", "");
  const [when, setWhen] = usePanelMemory("add:when", "");
  const inputRef = useRef<any>(null);
  const addRpc = useRpc(tasksAddRpc);
  const add = useMutation({
    mutationFn: (input: { name: string; tag: string; scheduledAt: string }) => addRpc(input),
    onSuccess: () => { setName(""); setWhen(""); onAdded(); },
    onError,
  });
  const tag = tags[tagIndex % Math.max(1, tags.length)] || "正事";
  const submit = () => {
    const text = name.trim();
    if (!text || add.isPending) return;
    const scheduledAt = parseUserDateTime(when);
    if (scheduledAt === null) {
      onError(new Error("时间格式不对，例如 9-30 14:00 或 14:00"));
      return;
    }
    add.mutate({ name: text, tag, scheduledAt });
  };
  return (
    <View style={styles.addRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`标签 ${tag}，点按切换`}
        onPress={() => setTagIndex((index) => (index + 1) % Math.max(1, tags.length))} style={styles.tagPill}>
        <Text style={styles.tagPillText}>{tag}</Text>
      </Pressable>
      <TextInput ref={inputRef} value={name} onChangeText={setName} onSubmitEditing={submit} placeholder="添加任务..."
        placeholderTextColor={styles.placeholder.color} style={styles.input} returnKeyType="done" blurOnSubmit={false} />
      <TextInput value={when} onChangeText={setWhen} onSubmitEditing={submit} placeholder="时间"
        placeholderTextColor={styles.placeholder.color} style={styles.timeInput} />
    </View>
  );
}

function AgendaRow({ styles, item, now, onPick }: {
  styles: Styles; item: AgendaItem; now: Date; onPick(task: Task): void;
}) {
  const tone = item.overdue ? styles.agendaOverdue : item.soon ? styles.agendaSoon : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`编辑 ${item.task.name}`}
      onPress={() => onPick(item.task)} style={styles.calendarItem}>
      <Text style={[styles.calendarWhen, tone]}>{formatScheduleTag(item.task.scheduledAt, now)}</Text>
      <Text style={[styles.taskName, styles.agendaName, tone]} numberOfLines={1}>{item.task.name}</Text>
    </Pressable>
  );
}

function CalendarPanel({ styles, tasks, now, onPick }: {
  styles: Styles; tasks: Task[]; now: Date; onPick(task: Task): void;
}) {
  const items = buildAgenda(tasks, 7, now);
  return (
    <View style={styles.calendar}>
      <Text style={styles.calendarTitle}>日程 · 未来 7 天</Text>
      {items.length ? items.map((item) => (
        <AgendaRow key={item.task.id} styles={styles} item={item} now={now} onPick={onPick} />
      )) : <Text style={styles.muted}>未来 7 天没有安排时间的任务</Text>}
    </View>
  );
}

function TaskRow({ styles, task, planContext, completing, onComplete, onRemovePlan, onOpen, evaOpening, onEva }: {
  styles: Styles;
  task: Task;
  planContext: string;
  completing: boolean;
  onComplete(): void;
  onRemovePlan(): void;
  onOpen(): void;
  evaOpening: boolean;
  onEva?: () => void;
}) {
  const isNotification = task.source === "notification";
  const body = isNotification ? visibleNotificationDescription(task.description) : "";
  const webLink = /^https?:\/\//i.test(task.contentLink) ? task.contentLink : "";
  const scheduleTag = task.scheduledAt ? formatScheduleTag(task.scheduledAt) : "";
  return (
    <View style={[styles.taskRow, completing ? styles.taskCompleting : null]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`完成 ${task.name}`} disabled={completing}
        onPress={onComplete} style={styles.check}>
        <Text style={styles.checkText}>{completing ? "◌" : "○"}</Text>
      </Pressable>
      <View style={styles.taskMain}>
        <Pressable accessibilityRole="button" accessibilityLabel={`编辑 ${task.name}`} onPress={onOpen}>
          <Text style={styles.taskName}>
            {task.name}
            {scheduleTag ? <Text style={styles.scheduleTag}>{` · ${scheduleTag}`}</Text> : null}
          </Text>
        </Pressable>
        {/* Kept outside the Pressable so the text can be selected and copied. */}
        {body ? <Text style={styles.notificationBody} selectable>{body}</Text> : null}
      </View>
      {task.priority ? <Text style={styles.priority}>{task.priority}</Text> : null}
      {planContext ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`从${planDisplayName(planContext)}移出`}
          onPress={onRemovePlan} style={styles.rowIcon}>
          <Text style={styles.iconText}>−</Text>
        </Pressable>
      ) : null}
      {isNotification && onEva ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`和 EVA 处理 ${task.name}`}
          disabled={evaOpening} onPress={onEva} style={styles.rowIcon}>
          <Text style={styles.iconText}>{evaOpening ? "◌" : "→"}</Text>
        </Pressable>
      ) : null}
      {webLink ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`打开 ${webLink}`}
          onPress={() => void openExternal(webLink)} style={styles.rowIcon}>
          <Text style={styles.iconText}>↗</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
