/**
 * Text input with large touch target, clear button, and multiline support.
 */

import React, { useState } from 'react';
import { View, TextInput as RNTextInput, TouchableOpacity, Text, ViewStyle, TextStyle } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing, MIN_TOUCH_TARGET } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  maxLength?: number;
  label?: string;
  editable?: boolean;
  onSubmitEditing?: () => void;
}

export default function TextInput({
  value,
  onChangeText,
  placeholder,
  multiline = false,
  numberOfLines = 1,
  maxLength,
  label,
  editable = true,
  onSubmitEditing,
}: TextInputProps) {
  const [focused, setFocused] = useState(false);

  const containerStyle: ViewStyle = {
    gap: spacing.xs,
  };

  const inputStyle: TextStyle = {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: focused ? colors.primary : colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: multiline ? MIN_TOUCH_TARGET * numberOfLines : MIN_TOUCH_TARGET,
    color: colors.text,
    fontSize: typography.sizes.base,
    textAlignVertical: multiline ? 'top' : 'center',
  };

  return (
    <View style={containerStyle}>
      {label && (
        <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
          {label}
        </Text>
      )}
      <View>
        <RNTextInput
          style={inputStyle}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline={multiline}
          numberOfLines={numberOfLines}
          maxLength={maxLength}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={multiline ? 'default' : 'done'}
        />
        {value.length > 0 && editable && (
          <TouchableOpacity
            style={{ position: 'absolute', right: 12, top: 12 }}
            onPress={() => onChangeText('')}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 18 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
