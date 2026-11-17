# Pilot 01 — visual QA and storyboard decision

Date: 2026-11-17  
Branch: video/pilot-01-ai-task-brief-20261117  
Status: draft visual review only; not a video render

## Reviewed visual candidates

Four 16:9 generated stills were inspected:

1. **Opening candidate v1 — rejected.** Smartphone plus speech bubble. The model rendered corrupted/illegible Vietnamese text inside the phone and an unnecessary text label. Do not use in final.
2. **Middle frame — conditionally accepted.** Three dark navy cards with cyan icons for task, context, and desired output. Text is mostly legible, but must be re-created as editable captions in the video editor rather than relying on baked-in generated text.
3. **Ending frame — conditionally accepted.** DUNG - AI title, smartphone and verification document. Review spelling and diacritics at final export; retain only if the title remains exact and the visual is not misleading.
4. **Opening candidate v2 — preferred.** Smartphone with abstract placeholder lines and tangled speech bubbles resolving into a checkmark; no text artifacts. Use as the opening visual if final composition review passes.

## Editorial QA decisions

- Never use generated image text as authoritative copy. Add all Vietnamese titles and captions as editable text in the editor.
- Opening v1 is rejected due to garbled text.
- Opening v2 is preferred because it communicates unclear input resolving into clarity without baked-in text.
- Middle frame should support the three spoken steps; ensure the three labels are rebuilt as real captions.
- Ending frame should retain the exact brand string **DUNG - AI**. Verify spelling manually.
- The visual set is static key art only. It is not an animated or narrated video.

## Production blockers

- No confirmed Vietnamese narration MP3/WAV is available to the assistant.
- User's selected reference voice remains PocketPal / Supertonic Alex (Male 1), Vietnamese, Quality 5; user described it as natural.
- Free Magnific voice generation quota was exhausted at the time checked; no credits were charged. Do not retry or upgrade.
- No free video-render capability was verified in the connected creative workspace.
- SRT timestamps are provisional and cannot be synchronized until the actual narration file exists.

## Release status

Keep PR in Draft. No merge, production deployment, or public publishing. This document does not modify Worker Production, DNS, D1, secrets, or public site content.
