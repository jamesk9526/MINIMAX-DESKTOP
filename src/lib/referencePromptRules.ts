// Ref2VA conditions on source assets; it should transfer their requested visual
// information into the generated world rather than turning the assets into
// literal on-screen media. A shot can explicitly override this when showing a
// photograph, screen, poster, or other reference asset is genuinely intended.
export const referenceVisibilityRule = 'REFERENCE VISIBILITY RULE: All <Picture #>, <Video #>, and <Audio #> assets are conditioning references only unless the detailed description explicitly requires the referenced media itself to appear on screen. Do not render reference images or reference videos as photographs, screens, posters, frames, overlays, split-screen elements, cutaways, or visible media. Transfer only the requested identity, appearance, motion, environment, object, composition, or style information into the generated scene. Their visual information should be naturally embodied in the generated scene.'

export function firstFrameVisualAnchorInstruction(pictureNumber: number) {
  if (!Number.isInteger(pictureNumber) || pictureNumber < 1) throw new Error('A first-frame visual anchor needs a valid picture number.')
  return `<Picture ${pictureNumber}> is the first-frame visual anchor for [Shot 1] at 0.00 seconds. Reconstruct the scene from its visual information with maximum fidelity, but do not show <Picture ${pictureNumber}> itself as an image or media element. The generated world should naturally embody its character, composition, wardrobe, environment, lighting, and camera framing. Motion develops naturally from this opening state.`
}

export function openingFrameReframeInstruction(pictureNumber: number, cameraAngle: string) {
  if (!Number.isInteger(pictureNumber) || pictureNumber < 1) throw new Error('An opening-frame reframe needs a valid picture number.')
  const angle = cameraAngle.trim()
  if (!angle) throw new Error('Choose an opening camera angle.')
  return `<Picture ${pictureNumber}> is the visual and spatial reference for the opening of [Shot 1], defining the environment, lighting, spatial arrangement, and initial subject placement. The target shot intentionally changes the viewpoint to a cinematic ${angle} while preserving the scene's visual identity and spatial relationships. Do not show <Picture ${pictureNumber}> itself as an image or media element. Motion begins only after this reframed opening state is established.`
}

export function openingFrameCameraArcInstruction(pictureNumber: number, cameraAngle: string) {
  if (!Number.isInteger(pictureNumber) || pictureNumber < 1) throw new Error('An opening-frame camera arc needs a valid picture number.')
  const angle = cameraAngle.trim()
  if (!angle) throw new Error('Choose a target camera angle.')
  return `[Shot 1] The target shot begins from the visual state represented by <Picture ${pictureNumber}>, preserving its opening composition, environment, lighting, spatial arrangement, and initial subject placement. Immediately after the opening state is established, the camera performs a smooth, physically plausible lateral arc until it reaches a cinematic ${angle}; motion then continues naturally from that view. Do not show <Picture ${pictureNumber}> itself as an image or media element.`
}
