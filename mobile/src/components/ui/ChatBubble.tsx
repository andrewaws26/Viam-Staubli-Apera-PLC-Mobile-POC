/**
 * Chat message bubble with markdown rendering for AI responses.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

const markdownStyles = {
  body: { color: colors.text, fontSize: typography.sizes.sm, lineHeight: 20 },
  strong: { color: '#ffffff', fontWeight: '600' as const },
  em: { color: colors.primaryLight },
  paragraph: { marginBottom: 8 },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 4 },
  code_inline: {
    backgroundColor: '#374151',
    color: colors.primaryLight,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: typography.sizes.xs,
  },
};

export default function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === 'user';

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <Text style={styles.roleLabel}>
        {isUser ? 'You' : 'AI Mechanic'}
      </Text>
      {isUser ? (
        <Text style={styles.userText}>{content}</Text>
      ) : (
        <Markdown style={markdownStyles}>{content}</Markdown>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  userContainer: {
    backgroundColor: '#7c3aed15',
    borderColor: '#7c3aed30',
    marginLeft: spacing['3xl'],
  },
  assistantContainer: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    marginRight: spacing.lg,
  },
  roleLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.heading,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  userText: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
  },
});
