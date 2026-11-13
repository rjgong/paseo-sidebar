import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type Task,
  tasksChangePlanRpc,
  tasksChangeTagRpc,
  tasksDeleteRpc,
  tasksRenameRpc,
  tasksScheduleRpc,
} from "../shared/contracts";
import { parseUserDateTime, planDisplayName, toEditableDateTime } from "./model";
import { visibleNotificationDescription } from "../shared/feedback";
import type { Styles } from "./styles";

// Replaces the Cursor sidebar's drag-and-drop and double-click rename, which
// have no touch equivalent: tap a task to open this sheet.
export function TaskActionsModal({ styles, task, tags, planTags, onClose, onChanged, onError }: {
  styles: Styles;
  task: Task | null;
  tags: string[];
  planTags: string[];
  onClose(): void;
  onChanged(): void;
  onError(error: unknown): void;
}) {
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setName(task?.name || "");
    setWhen(toEditableDateTime(task?.scheduledAt || ""));
    setConfirmDelete(false);
  }, [task?.id]);

  const rename = useRpc(tasksRenameRpc);
  const changeTag = useRpc(tasksChangeTagRpc);
  const changePlan = useRpc(tasksChangePlanRpc);
  const schedule = useRpc(tasksScheduleRpc);
  const remove = useRpc(tasksDeleteRpc);
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { onChanged(); onClose(); },
    onError,
  });

  if (!task) return null;
  const isNotification = task.source === "notification";
  const notificationBody = isNotification ? visibleNotificationDescription(task.description) : "";
  const busy = action.isPending;
  const saveName = () => {
    const value = name.trim();
    if (value && value !== task.name) action.mutate(() => rename({ id: task.id, name: value }));
  };
  const saveTime = (text: string) => {
    const scheduledAt = parseUserDateTime(text);
    if (scheduledAt === null) {
      onError(new Error("时间格式不对，例如 2026-09-30 14:00、9-30 14:00 或 14:00"));
      return;
    }
    action.mutate(() => schedule({ id: task.id, scheduledAt }));
  };

  return (
    <Modal title="任务" open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content>
        <View style={styles.modalBlock}>
          <Text style={styles.modalLabel}>名称</Text>
          <View style={styles.modalRow}>
            <TextInput value={name} onChangeText={setName} onSubmitEditing={saveName} style={styles.input} />
            <Pressable accessibilityRole="button" disabled={busy} onPress={saveName} style={styles.modalButton}>
              <Text style={styles.modalButtonText}>改名</Text>
            </Pressable>
          </View>
        </View>

        {!isNotification ? (
          <View style={styles.modalBlock}>
            <Text style={styles.modalLabel}>计划（今天 {task.plans.length ? "已排" : "未排"}）</Text>
            <View style={styles.modalRow}>
              {planTags.map((plan) => {
                const active = task.plans.includes(plan);
                return (
                  <Pressable key={plan} accessibilityRole="button" disabled={busy || active}
                    onPress={() => action.mutate(() => changePlan({ id: task.id, plan }))}
                    style={active ? styles.choiceActive : styles.choice}>
                    <Text style={active ? styles.choiceActiveText : styles.choiceText}>{planDisplayName(plan)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {!isNotification ? (
          <View style={styles.modalBlock}>
            <Text style={styles.modalLabel}>标签</Text>
            <View style={styles.modalRow}>
              {tags.map((tag) => {
                const active = task.tag === tag;
                return (
                  <Pressable key={tag} accessibilityRole="button" disabled={busy || active}
                    onPress={() => action.mutate(() => changeTag({ id: task.id, tag }))}
                    style={active ? styles.choiceActive : styles.choice}>
                    <Text style={active ? styles.choiceActiveText : styles.choiceText}>{tag}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {!isNotification ? (
          <View style={styles.modalBlock}>
            <Text style={styles.modalLabel}>日程时间（例如 9-30 14:00）</Text>
            <View style={styles.modalRow}>
              <TextInput value={when} onChangeText={setWhen} onSubmitEditing={() => saveTime(when)}
                placeholder="未安排" placeholderTextColor={styles.placeholder.color} style={styles.input} />
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => saveTime(when)} style={styles.modalButton}>
                <Text style={styles.modalButtonText}>保存</Text>
              </Pressable>
              {task.scheduledAt ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => saveTime("")} style={styles.modalButton}>
                  <Text style={styles.modalButtonText}>清除</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {isNotification && notificationBody ? (
          <View style={styles.modalBlock}>
            <Text style={styles.modalLabel}>通知内容</Text>
            <Text style={styles.notificationBody} selectable>{notificationBody}</Text>
          </View>
        ) : null}

        {task.contentLink ? <Text style={styles.muted} selectable>链接：{task.contentLink}</Text> : null}

        <Pressable accessibilityRole="button" disabled={busy}
          onPress={() => (confirmDelete ? action.mutate(() => remove({ id: task.id })) : setConfirmDelete(true))}
          style={styles.dangerButton}>
          <Text style={styles.dangerText}>{confirmDelete ? "再点一次确认删除" : "删除任务"}</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}
