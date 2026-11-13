import type { PluginTheme } from "@getpaseo/plugin";
import { StyleSheet } from "react-native";

export function makeStyles(theme: PluginTheme, compact: boolean) {
  const c = theme.colors;
  const pad = compact ? 10 : 14;
  const chipBase = {
    color: c.foregroundMuted,
    fontSize: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: c.surface1,
  };
  const choiceBase = { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1 };
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.surface0, paddingTop: pad },
    chip: chipBase,
    spacer: { flexGrow: 1 },
    muted: { color: c.foregroundMuted, fontSize: 12 },
    error: { color: c.statusDanger, fontSize: 12 },
    placeholder: { color: c.foregroundMuted },
    iconButton: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center", borderRadius: 4 },
    iconText: { color: c.foregroundMuted, fontSize: 15 },
    iconActive: { color: c.accent, fontSize: 15 },
    iconDisabled: { color: c.border, fontSize: 15 },
    rowIcon: { minWidth: 24, minHeight: 22, alignItems: "center", justifyContent: "center", borderRadius: 4 },
    receipt: {
      flexDirection: "row", gap: 8, marginHorizontal: pad, marginBottom: 8, padding: 10,
      borderRadius: 8, borderWidth: 1, borderColor: c.statusSuccess, backgroundColor: c.surface1,
    },
    receiptIcon: { color: c.statusSuccess, fontSize: 16, fontWeight: "700" },
    receiptBody: { flex: 1, gap: 2 },
    receiptKicker: { color: c.statusSuccess, fontSize: 11 },
    receiptTitle: { color: c.foreground, fontSize: 14, fontWeight: "600" },
    receiptDetail: { color: c.foregroundMuted, fontSize: 12 },
    receiptNext: { color: c.accent, fontSize: 12 },
    addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: pad, paddingBottom: 8 },
    tagPill: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: c.surface2 },
    tagPillText: { color: c.foreground, fontSize: 13 },
    input: {
      flex: 1, minWidth: 80, color: c.foreground, fontSize: 14, paddingHorizontal: 8, paddingVertical: 6,
      borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1,
    },
    timeInput: {
      width: 76, color: c.foreground, fontSize: 13, paddingHorizontal: 6, paddingVertical: 6,
      borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1,
    },
    calendar: {
      marginHorizontal: pad, marginBottom: 8, padding: 8, gap: 4,
      borderRadius: 8, borderWidth: 1, borderColor: c.border,
    },
    calendarTitle: { color: c.foregroundMuted, fontSize: 12, marginBottom: 2 },
    calendarItem: { flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 3 },
    calendarWhen: { color: c.accent, fontSize: 12, minWidth: 96 },
    agenda: {
      marginHorizontal: pad, marginBottom: 8, paddingHorizontal: 8, paddingVertical: 6, gap: 2,
      borderRadius: 8, backgroundColor: c.surface1,
    },
    agendaName: { flex: 1 },
    agendaSoon: { color: c.statusWarning },
    agendaOverdue: { color: c.statusDanger },
    scheduleTag: { color: c.foregroundMuted, fontSize: 12 },
    list: { flex: 1 },
    listContent: { paddingHorizontal: pad, paddingBottom: 24, gap: 2 },
    section: { gap: 0 },
    planLine: { height: 1, backgroundColor: c.border, marginVertical: 3 },
    groupHeader: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, marginBottom: 1 },
    groupTitle: { color: c.foreground, fontSize: 12, fontWeight: "600" },
    groupCount: { color: c.foregroundMuted, fontSize: 12 },
    taskRow: { flexDirection: "row", alignItems: "flex-start", gap: 4, paddingVertical: 0, borderRadius: 4 },
    taskCompleting: { opacity: 0.5 },
    check: { minWidth: 24, minHeight: 22, alignItems: "center", justifyContent: "center" },
    checkText: { color: c.foregroundMuted, fontSize: 16 },
    taskMain: { flex: 1, paddingVertical: 2 },
    taskName: { flex: 1, color: c.foreground, fontSize: 14 },
    notificationBody: { color: c.foregroundMuted, fontSize: 12, marginTop: 2 },
    readerText: { color: c.foreground, fontSize: 16, lineHeight: 28 },
    priority: { color: c.statusWarning, fontSize: 11 },
    modalBlock: { gap: 6 },
    modalLabel: { color: c.foregroundMuted, fontSize: 12 },
    modalRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
    modalButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6, backgroundColor: c.surface2 },
    modalButtonText: { color: c.foreground, fontSize: 13 },
    choice: { ...choiceBase, borderColor: c.border },
    choiceText: { color: c.foreground, fontSize: 13 },
    choiceActive: { ...choiceBase, borderColor: c.accent, backgroundColor: c.accent },
    choiceActiveText: { color: c.accentForeground, fontSize: 13 },
    dangerButton: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6, borderWidth: 1, borderColor: c.statusDanger },
    dangerText: { color: c.statusDanger, fontSize: 13 },
  });
}

export type Styles = ReturnType<typeof makeStyles>;
