/**
 * Work Order Detail screen.
 * Shows full work order with status controls, subtask checklist,
 * notes feed, blocker input, and linked truck data.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, ScrollView, Text, Alert, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, TextInput as RNTextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppAuth } from '@/auth/auth-provider';
import { useWorkStore } from '@/stores/work-store';
import { useChatStore } from '@/stores/chat-store';
import { fetchTeamMembers } from '@/services/api-client';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Button from '@/components/ui/Button';
import TextInput from '@/components/ui/TextInput';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { timeAgo } from '@/utils/format';
import { lookupSPN } from '@/utils/spn-lookup';
import type { WorkOrder, WorkOrderStatus, WorkOrderSubtask } from '@/types/work-order';
import type { ChatThread, ChatMessage, ChatReaction } from '@/types/chat';
import { VALID_REACTIONS, REACTION_LABELS } from '@/types/chat';

interface TeamMember {
  id: string;
  name: string;
  role: string;
}

const STATUSES: WorkOrderStatus[] = ['open', 'in_progress', 'blocked', 'done'];
const STATUS_LABELS = ['Open', 'In Progress', 'Blocked', 'Done'];
const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  open: 'muted',
  in_progress: 'warning',
  blocked: 'danger',
  done: 'success',
};
const PRIORITY_COLORS: Record<string, string> = {
  urgent: colors.danger,
  normal: colors.primaryLight,
  low: colors.textMuted,
};

export default function WorkOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentUser } = useAppAuth();
  const { workOrders, patchWorkOrder, loadWorkOrders } = useWorkStore();

  const [noteText, setNoteText] = useState('');
  const [blockerText, setBlockerText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showAssignSheet, setShowAssignSheet] = useState(false);

  const wo = useMemo(() => workOrders.find((w) => w.id === id), [workOrders, id]);

  // Optimistic subtask state for instant toggle feedback
  const [localSubtasks, setLocalSubtasks] = useState<WorkOrderSubtask[]>(wo?.subtasks ?? []);
  useEffect(() => {
    if (wo?.subtasks) setLocalSubtasks(wo.subtasks);
  }, [wo?.subtasks]);

  useEffect(() => {
    if (!wo) loadWorkOrders();
  }, [wo, loadWorkOrders]);

  useEffect(() => {
    if (wo?.blocker_reason) setBlockerText(wo.blocker_reason);
  }, [wo?.blocker_reason]);

  // Load team members for assignment
  useEffect(() => {
    (async () => {
      const result = await fetchTeamMembers();
      if (result.data) setTeamMembers(result.data as unknown as TeamMember[]);
    })();
  }, []);

  const handleStatusChange = useCallback(async (index: number) => {
    if (!wo) return;
    const newStatus = STATUSES[index];
    if (newStatus === wo.status) return;

    // If setting to blocked, prompt for reason
    if (newStatus === 'blocked') {
      Alert.prompt(
        'What\'s blocking this?',
        'e.g., Waiting on parts, truck in the field',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Set Blocked',
            onPress: async (reason?: string) => {
              await patchWorkOrder(wo.id, {
                status: 'blocked',
                blocker_reason: reason || 'No reason given',
              });
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            },
          },
        ],
        'plain-text',
        wo.blocker_reason || '',
      );
      return;
    }

    await patchWorkOrder(wo.id, { status: newStatus });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [wo, patchWorkOrder]);

  const handleToggleSubtask = useCallback(async (subtaskId: string) => {
    if (!wo) return;
    // Optimistic local update for instant feedback
    setLocalSubtasks((prev) =>
      prev.map((s) => (s.id === subtaskId ? { ...s, is_done: !s.is_done } : s)),
    );
    Haptics.selectionAsync();
    await patchWorkOrder(wo.id, { toggle_subtask_id: subtaskId });
  }, [wo, patchWorkOrder]);

  const handleAssign = useCallback(async (userId: string | null, userName: string | null) => {
    if (!wo) return;
    await patchWorkOrder(wo.id, {
      assigned_to: userId,
      assigned_to_name: userName,
    });
    setShowAssignSheet(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [wo, patchWorkOrder]);

  const handleAddNote = useCallback(async () => {
    if (!wo || !noteText.trim()) return;
    setSubmitting(true);
    await patchWorkOrder(wo.id, { note: noteText.trim() });
    setNoteText('');
    setSubmitting(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [wo, noteText, patchWorkOrder]);

  const handlePickUp = useCallback(async () => {
    if (!wo || !currentUser) return;
    await patchWorkOrder(wo.id, {
      assigned_to: currentUser.id,
      assigned_to_name: currentUser.name,
      status: 'in_progress',
      note: `${currentUser.name} picked up this work order`,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [wo, currentUser, patchWorkOrder]);

  if (!wo) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const statusIndex = STATUSES.indexOf(wo.status);
  const isAssignedToMe = currentUser && wo.assigned_to === currentUser.id;
  const isUnassigned = wo.assigned_to === null;
  const subtasksDone = localSubtasks.filter((s) => s.is_done).length;
  const subtasksTotal = localSubtasks.length;

  return (
    <ScrollView style={styles.container}>
      {/* Priority + title */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[wo.priority] }]} />
          <Text style={styles.title}>{wo.title}</Text>
        </View>
        <View style={styles.metaRow}>
          <Badge label={wo.priority.toUpperCase()} variant={wo.priority === 'urgent' ? 'danger' : 'muted'} small />
          <Text style={styles.metaText}>by {wo.created_by_name}</Text>
          <Text style={styles.metaText}>{timeAgo(wo.created_at)}</Text>
        </View>
      </View>

      {/* Status control */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Status</Text>
        <SegmentedControl
          options={STATUS_LABELS}
          selectedIndex={statusIndex}
          onChange={handleStatusChange}
        />
      </View>

      {/* Blocker banner */}
      {wo.status === 'blocked' && wo.blocker_reason && (
        <Card style={styles.blockerCard}>
          <Text style={styles.blockerLabel}>Blocked</Text>
          <Text style={styles.blockerReason}>{wo.blocker_reason}</Text>
        </Card>
      )}

      {/* Pick up button for unassigned work */}
      {isUnassigned && wo.status === 'open' && (
        <View style={styles.section}>
          <Button
            title="Pick Up This Work Order"
            onPress={handlePickUp}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      )}

      {/* Assignment */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Assigned to</Text>
        <View style={styles.assignRow}>
          <Text style={styles.assignee}>
            {wo.assigned_to_name || 'Unassigned (backlog)'}
            {isAssignedToMe ? '  (you)' : ''}
          </Text>
          <TouchableOpacity
            style={styles.assignBtn}
            onPress={() => setShowAssignSheet(!showAssignSheet)}
          >
            <Text style={styles.assignBtnText}>
              {wo.assigned_to ? 'Reassign' : 'Assign'}
            </Text>
          </TouchableOpacity>
        </View>

        {showAssignSheet && (
          <View style={styles.assignSheet}>
            {wo.assigned_to && (
              <TouchableOpacity
                style={styles.assignOption}
                onPress={() => handleAssign(null, null)}
              >
                <Text style={styles.assignOptionUnassign}>Unassign</Text>
              </TouchableOpacity>
            )}
            {teamMembers.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={styles.assignOption}
                onPress={() => handleAssign(m.id, m.name)}
              >
                <View style={styles.assignAvatar}>
                  <Text style={styles.assignAvatarText}>{m.name.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={[
                  styles.assignOptionName,
                  m.id === wo.assigned_to && { color: colors.primaryLight },
                ]}>
                  {m.name}
                </Text>
                <Text style={styles.assignOptionRole}>{m.role}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Description */}
      {wo.description && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Description</Text>
          <Text style={styles.description}>{wo.description}</Text>
        </View>
      )}

      {/* Subtasks */}
      {subtasksTotal > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Tasks ({subtasksDone}/{subtasksTotal})
          </Text>
          {localSubtasks.map((st) => (
            <TouchableOpacity
              key={st.id}
              style={styles.subtaskRow}
              onPress={() => handleToggleSubtask(st.id)}
              activeOpacity={0.6}
            >
              <View style={[styles.checkbox, st.is_done && styles.checkboxDone]}>
                {st.is_done && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.subtaskText, st.is_done && styles.subtaskDone]}>
                {st.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Linked DTCs */}
      {wo.linked_dtcs && wo.linked_dtcs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Linked DTCs</Text>
          {wo.linked_dtcs.map((dtc, i) => {
            const spnInfo = lookupSPN(dtc.spn);
            return (
              <View key={`${dtc.spn}-${dtc.fmi}-${i}`} style={styles.dtcRow}>
                <Badge label={`SPN ${dtc.spn} / FMI ${dtc.fmi}`} variant="danger" small />
                <Text style={styles.dtcEcu}>{dtc.ecuLabel}</Text>
                {spnInfo && <Text style={styles.dtcName}>{spnInfo.name}</Text>}
              </View>
            );
          })}
        </View>
      )}

      {/* Truck snapshot */}
      {wo.truck_snapshot && (
        <Card style={styles.snapshotCard}>
          <Text style={styles.snapshotTitle}>Readings at creation</Text>
          <View style={styles.snapshotGrid}>
            {wo.truck_snapshot.engine_rpm != null && (
              <SnapshotMetric label="RPM" value={`${wo.truck_snapshot.engine_rpm}`} />
            )}
            {wo.truck_snapshot.coolant_temp_f != null && (
              <SnapshotMetric label="Coolant" value={`${wo.truck_snapshot.coolant_temp_f}°F`} />
            )}
            {wo.truck_snapshot.oil_pressure_psi != null && (
              <SnapshotMetric label="Oil PSI" value={`${wo.truck_snapshot.oil_pressure_psi}`} />
            )}
            {wo.truck_snapshot.fuel_level_pct != null && (
              <SnapshotMetric label="Fuel" value={`${Math.round(wo.truck_snapshot.fuel_level_pct as number)}%`} />
            )}
            {wo.truck_snapshot.vehicle_distance_mi != null && (
              <SnapshotMetric label="Odometer" value={`${Math.round(wo.truck_snapshot.vehicle_distance_mi as number)} mi`} />
            )}
            {wo.truck_snapshot.engine_hours != null && (
              <SnapshotMetric label="Hours" value={`${Math.round(wo.truck_snapshot.engine_hours as number)}`} />
            )}
          </View>
        </Card>
      )}

      {/* Add note */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Add Note</Text>
        <TextInput
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Parts ordered, reassigned, found the issue..."
          multiline
          numberOfLines={3}
        />
        <Button
          title={submitting ? 'Adding...' : 'Add Note'}
          onPress={handleAddNote}
          size="md"
          variant="secondary"
          disabled={!noteText.trim() || submitting}
        />
      </View>

      {/* Discussion / Chat */}
      <View style={styles.section}>
        <WorkOrderChat workOrderId={wo.id} currentUserId={currentUser?.id || ''} />
      </View>

      <View style={{ height: spacing['5xl'] }} />
    </ScrollView>
  );
}

// ── Inline Work Order Chat ───────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  developer: '#a855f7',
  manager: '#3b82f6',
  mechanic: '#22c55e',
  operator: '#eab308',
  ai: '#06b6d4',
};

function WorkOrderChat({ workOrderId, currentUserId }: { workOrderId: string; currentUserId: string }) {
  const { getOrCreateEntityThread, sendMessage, fetchMessages, messages, toggleReaction } = useChatStore();
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<RNTextInput>(null);

  useEffect(() => {
    (async () => {
      try {
        const t = await getOrCreateEntityThread('work_order', workOrderId);
        setThread(t);
        await fetchMessages(t.id);
      } catch {
        // Thread creation failed — silently show empty
      } finally {
        setLoading(false);
      }
    })();
  }, [workOrderId, getOrCreateEntityThread, fetchMessages]);

  // Poll for new messages every 5s when expanded
  useEffect(() => {
    if (!expanded || !thread) return;
    const interval = setInterval(async () => {
      const msgs = messages[thread.id] || [];
      if (msgs.length === 0) return;
      // Re-fetch will pick up new messages via store
      await fetchMessages(thread.id);
    }, 5000);
    return () => clearInterval(interval);
  }, [expanded, thread, messages, fetchMessages]);

  const handleSend = useCallback(async () => {
    if (!thread || !text.trim() || sending) return;
    setSending(true);
    const mentionAi = text.toLowerCase().includes('@ai');
    await sendMessage({ threadId: thread.id, body: text.trim(), mentionAi });
    setText('');
    setSending(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [thread, text, sending, sendMessage]);

  if (loading) {
    return (
      <View style={chatStyles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={chatStyles.loadingText}>Loading discussion...</Text>
      </View>
    );
  }

  if (!thread) return null;

  const threadMessages = messages[thread.id] || [];

  return (
    <View style={chatStyles.container}>
      <TouchableOpacity
        style={chatStyles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <Text style={chatStyles.headerLabel}>Discussion</Text>
        <View style={chatStyles.headerRight}>
          {threadMessages.length > 0 && (
            <Text style={chatStyles.msgCount}>{threadMessages.length} msg{threadMessages.length !== 1 ? 's' : ''}</Text>
          )}
          <Text style={chatStyles.chevron}>{expanded ? '▼' : '▶'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={chatStyles.chatBody}>
          {threadMessages.length === 0 ? (
            <Text style={chatStyles.emptyText}>No messages yet. Start the conversation.</Text>
          ) : (
            <View style={chatStyles.messageList}>
              {threadMessages.map((msg) => {
                const isOwn = msg.senderId === currentUserId;
                const isAi = msg.messageType === 'ai';
                const isSystem = msg.messageType === 'system';

                if (isSystem) {
                  return (
                    <View key={msg.id} style={chatStyles.systemMsg}>
                      <Text style={chatStyles.systemMsgText}>{msg.body}</Text>
                    </View>
                  );
                }

                return (
                  <View key={msg.id} style={[chatStyles.bubble, isOwn ? chatStyles.bubbleOwn : isAi ? chatStyles.bubbleAi : chatStyles.bubbleOther]}>
                    {!isOwn && (
                      <View style={chatStyles.senderRow}>
                        <Text style={chatStyles.senderName}>{msg.senderName}</Text>
                        <Text style={[chatStyles.senderRole, { color: ROLE_COLORS[msg.senderRole] || colors.textMuted }]}>
                          {msg.senderRole.toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text style={chatStyles.msgBody}>{msg.body}</Text>
                    <Text style={chatStyles.timestamp}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {/* Reactions */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <View style={chatStyles.reactionRow}>
                        {msg.reactions.map((rs) =>
                          rs.count > 0 ? (
                            <TouchableOpacity
                              key={rs.reaction}
                              style={chatStyles.reactionPill}
                              onPress={() => toggleReaction(thread.id, msg.id, rs.reaction)}
                            >
                              <Text style={chatStyles.reactionText}>{REACTION_LABELS[rs.reaction].emoji} {rs.count}</Text>
                            </TouchableOpacity>
                          ) : null
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Input */}
          <View style={chatStyles.inputRow}>
            <RNTextInput
              ref={inputRef}
              style={chatStyles.textInput}
              value={text}
              onChangeText={setText}
              placeholder="Type a message..."
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[chatStyles.sendBtn, (!text.trim() || sending) && chatStyles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
            >
              <Text style={chatStyles.sendBtnText}>{sending ? '...' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const chatStyles = StyleSheet.create({
  container: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  loadingText: { color: colors.textMuted, fontSize: typography.sizes.xs },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, backgroundColor: colors.card },
  headerLabel: { color: colors.textSecondary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold as any, textTransform: 'uppercase', letterSpacing: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  msgCount: { color: colors.textMuted, fontSize: typography.sizes.xs },
  chevron: { color: colors.textMuted, fontSize: typography.sizes.xs },
  chatBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  emptyText: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'center', paddingVertical: spacing.xl },
  messageList: { padding: spacing.sm, gap: spacing.xs, maxHeight: 400 },
  systemMsg: { alignItems: 'center', paddingVertical: spacing.xs },
  systemMsgText: { color: colors.textMuted, fontSize: 11, fontStyle: 'italic' },
  bubble: { maxWidth: '85%', borderRadius: 12, padding: spacing.sm, marginBottom: 2 },
  bubbleOwn: { alignSelf: 'flex-end', backgroundColor: '#7c3aed20', borderWidth: 1, borderColor: '#7c3aed40' },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  bubbleAi: { alignSelf: 'flex-start', backgroundColor: '#0891b210', borderWidth: 1, borderColor: '#0891b230' },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  senderName: { color: colors.text, fontSize: 11, fontWeight: typography.weights.semibold as any },
  senderRole: { fontSize: 9, fontWeight: typography.weights.bold as any },
  msgBody: { color: colors.text, fontSize: typography.sizes.sm, lineHeight: 18 },
  timestamp: { color: colors.textMuted, fontSize: 9, marginTop: 2 },
  reactionRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  reactionPill: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  reactionText: { fontSize: 11, color: colors.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  textInput: { flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text, fontSize: typography.sizes.sm, maxHeight: 80 },
  sendBtn: { backgroundColor: '#7c3aed', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 10 },
  sendBtnDisabled: { backgroundColor: colors.border },
  sendBtnText: { color: '#fff', fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold as any },
});

// ── Snapshot Metric ──────────────────────────────────────────────────

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.snapshotMetric}>
      <Text style={styles.snapshotMetricLabel}>{label}</Text>
      <Text style={styles.snapshotMetricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: colors.textMuted, fontSize: typography.sizes.base },
  header: { padding: spacing.lg, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  priorityDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  title: { color: colors.text, fontSize: typography.sizes.lg, fontWeight: typography.weights.bold as any, flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaText: { color: colors.textMuted, fontSize: typography.sizes.xs },
  section: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  sectionLabel: { color: colors.textSecondary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold as any, textTransform: 'uppercase', letterSpacing: 1 },
  assignee: { color: colors.text, fontSize: typography.sizes.base, flex: 1 },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  assignBtn: { backgroundColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 8 },
  assignBtnText: { color: colors.textSecondary, fontSize: typography.sizes.xs, fontWeight: typography.weights.semibold as any },
  assignSheet: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm, overflow: 'hidden' },
  assignOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  assignOptionUnassign: { color: colors.textMuted, fontSize: typography.sizes.sm },
  assignOptionName: { color: colors.text, fontSize: typography.sizes.sm, flex: 1 },
  assignOptionRole: { color: colors.textMuted, fontSize: typography.sizes.xs },
  assignAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  assignAvatarText: { color: colors.textSecondary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold as any },
  description: { color: colors.textSecondary, fontSize: typography.sizes.sm, lineHeight: 20 },
  blockerCard: { marginHorizontal: spacing.lg, marginBottom: spacing.lg, backgroundColor: '#dc262615', borderColor: '#dc262640', borderWidth: 1 },
  blockerLabel: { color: colors.dangerLight, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold as any, textTransform: 'uppercase', letterSpacing: 1 },
  blockerReason: { color: colors.text, fontSize: typography.sizes.sm, marginTop: spacing.xs },
  // Subtasks
  subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  subtaskText: { color: colors.text, fontSize: typography.sizes.sm, flex: 1 },
  subtaskDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  // DTCs
  dtcRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  dtcEcu: { color: colors.textMuted, fontSize: typography.sizes.xs },
  dtcName: { color: colors.textSecondary, fontSize: typography.sizes.xs, flex: 1 },
  // Snapshot
  snapshotCard: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
  snapshotTitle: { color: colors.textMuted, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold as any, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  snapshotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  snapshotMetric: { alignItems: 'center', minWidth: 70 },
  snapshotMetricLabel: { color: colors.textMuted, fontSize: 10 },
  snapshotMetricValue: { color: colors.text, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold as any },
});
