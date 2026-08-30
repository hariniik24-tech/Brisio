import { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type StackScreenShellProps = PropsWithChildren<{
  footer?: ReactNode;
}>;

export function StackScreenShell({ children, footer }: StackScreenShellProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.three,
          paddingBottom: insets.bottom + Spacing.four,
        },
      ]}>
      <ThemedView style={styles.container}>{children}</ThemedView>
      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  container: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
  },
});