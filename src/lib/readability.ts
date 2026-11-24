import settings from '../config/readability.json';

export function readableTypography(fontSize: number | undefined, lineHeight: number | undefined,
  seniorMode: boolean, inheritedSize?: number) {
  const original = fontSize ?? inheritedSize ?? settings.bodyFontSize;
  const increment = seniorMode && (fontSize !== undefined || inheritedSize === undefined) ? settings.seniorFontIncrement : 0;
  const size = Math.max(seniorMode ? settings.seniorMinimumFontSize : settings.minimumFontSize, original + increment);
  return { fontSize: size, lineHeight: Math.max(lineHeight ?? 0, Math.ceil(size * settings.lineHeightRatio)) };
}
