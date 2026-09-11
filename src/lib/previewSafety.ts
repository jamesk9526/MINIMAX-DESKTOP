/**
 * A local, deliberately conservative privacy cue for preview surfaces. This is
 * not a content classifier and never blocks, changes, or uploads a render.
 */
export function hasSensitivePreviewWording(prompt: string) {
  return /\b(?:nsfw|porn(?:ography)?|explicit(?:ly)?|erotic|sexual(?:ly)?|fetish|nud(?:e|ity)|naked|masturbat\w*|genitals?|topless)\b/i.test(prompt)
}
