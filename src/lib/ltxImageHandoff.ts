/**
 * The default direction used when a finished still becomes an LTX I2V source.
 * Keep this deliberately motion-light: the first frame is the authority for
 * identity, wardrobe, scene layout, and the initial composition.
 */
export function buildLtxImageHandoffPrompt() {
  return `Animate the supplied image as the authoritative first frame for one continuous, photorealistic shot. Start by matching the reference frame exactly. Preserve the exact identity of every visible person: facial geometry, skin tone and texture, age, hairstyle and hairline, eyes, distinguishing features, body proportions, hands, wardrobe, accessories, and expression. The person must remain recognizably the same individual in every frame. Preserve the original environment, objects, layout, lighting direction, color treatment, and composition unless a later creative instruction explicitly changes them.

Use restrained, physically believable motion only: natural breathing, an occasional subtle blink, tiny posture and fabric movement, and a slow stable camera move when appropriate. When a person's eyes are visible, begin with eyes naturally open, clear irises and pupils, relaxed eyelids, and a believable attentive gaze; never freeze the eyelids wide open or create a vacant stare. Keep facial detail, anatomy, hands, and edges clean and temporally stable. Maintain the first-frame framing at the beginning; no abrupt reframing.

One continuous shot. No cuts, scene changes, identity drift, face swap, morphing, duplicate people, altered age, altered hair, altered wardrobe, warped anatomy, extra limbs or fingers, flicker, ghosting, smearing, motion blur, sudden camera moves, text, logos, subtitles, dialogue, narration, singing, or lip-sync. Use quiet natural ambient sound only.`
}

export function appendLtxVisionGrounding(prompt: string, description: string) {
  const concise = description.replace(/\s+/g, ' ').trim().slice(0, 900)
  if (!concise) return prompt
  return `${prompt}\n\nVisible-reference grounding: ${concise} Treat these as supporting observations from the supplied first frame. The image itself remains the source of truth; do not invent or alter unobserved details.`
}
