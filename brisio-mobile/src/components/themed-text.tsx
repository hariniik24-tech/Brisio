import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  smallBold: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
  default: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '500',
    letterSpacing: 0.15,
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    lineHeight: 46,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  link: {
    lineHeight: 22,
    fontSize: 14,
    fontWeight: '600',
  },
  linkPrimary: {
    lineHeight: 22,
    fontSize: 14,
    color: '#3c87f7',
    fontWeight: '600',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: '700' }) ?? '500',
    fontSize: 12,
    lineHeight: 18,
  },
});
