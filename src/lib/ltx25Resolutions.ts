export const LTX25_RESOLUTIONS = {
  landscape: ['608x352', '736x416', '864x480', '960x544', '1056x608', '1152x640', '1216x672', '1280x736', '1376x768', '1536x864', '1664x928', '1792x1024', '1920x1088'],
  portrait: ['352x608', '416x736', '480x864', '544x960', '608x1056', '640x1152', '672x1216', '736x1280', '768x1376', '864x1536', '928x1664', '1024x1792', '1088x1920'],
  square: ['512x512', '640x640', '768x768', '896x896', '1024x1024', '1152x1152', '1280x1280'],
} as const

export type Ltx25Orientation = keyof typeof LTX25_RESOLUTIONS

export const LTX25_MAX_PIXELS = 1920 * 1088

export function ltx25ResolutionLabel(size: string) {
  const [width, height] = size.split('x').map(Number)
  const pixels = width * height
  if (pixels >= 2_000_000) return 'Maximum'
  if (pixels >= 1_500_000) return 'High'
  if (pixels >= 1_000_000) return 'Balanced'
  return 'Standard'
}
