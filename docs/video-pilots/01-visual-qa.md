# Pilot 01 — visual QA and storyboard decision

Date: 2026-11-18  
Branch: video/pilot-01-ai-task-brief-20261117  
Status: review of a user-supplied MP4; not approved for release

## Reviewed visual candidates

Four 16:9 generated stills were inspected:

1. **Opening candidate v1 — rejected.** Smartphone plus speech bubble. The model rendered corrupted/illegible Vietnamese text inside the phone and an unnecessary text label. Do not use in final.
2. **Middle frame — conditionally accepted.** Three dark navy cards with cyan icons for task, context, and desired output. Text is mostly legible, but must be re-created as editable captions in the video editor rather than relying on baked-in generated text.
3. **Ending frame — conditionally accepted.** DUNG - AI title, smartphone and verification document. Review spelling and diacritics at final export; retain only if the title remains exact and the visual is not misleading.
4. **Opening candidate v2 — preferred.** Smartphone with abstract placeholder lines and tangled speech bubbles resolving into a checkmark; no text artifacts. Use as the opening visual if final composition review passes.

## User-supplied MP4 — technical and visual review

- File reviewed locally: 50.2 seconds, H.264, 512×910 portrait, AAC stereo 44.1 kHz, approximately 29.9 MB.
- Sampled frames at multiple points show a repeated **CapCut AI watermark**. Do not crop, obscure, or remove it unless the source terms explicitly permit that. Preferred fix: use a legitimate watermark-free export option available at no cost, or replace affected footage with original visuals.
- Subtitles appear small and low on the frame. Sampled frames around 32s and 41s show text/phrases cut off by the sampled scene timing. This is a spot-check, not a complete subtitle transcription or timing audit.
- The sampled end card around 47s shows the large **DUNG - AI** title crossing the image boundary, plus a smaller line reading “DUNG AI. Công nghệ”. Rebuild the end card with exact brand spelling **DUNG - AI**, safe margins, and phone-screen legibility.
- Audio stream exists. Technical level check: peak approximately -3.9 dBFS and mean approximately -22.5 dBFS. Silence detection found only short leading/trailing pauses (about 0.36s and 0.41s) at the selected threshold. These measurements do not establish speech clarity, pronunciation, factual accuracy, or subjective audio quality.
- No verified transcript of the MP4's spoken Vietnamese is available. Do not claim that narration has been listened to or transcribed.
- The provisional SRT ends at 58 seconds and cannot be used unchanged on this 50.2-second video. Do not proportionally rescale it; retime each cue against the actual spoken words after obtaining a reliable transcript.

## Editorial QA decisions

- Never use generated image text as authoritative copy. Add all Vietnamese titles and captions as editable text in the editor.
- Opening v1 is rejected due to garbled text.
- Opening v2 is preferred because it communicates unclear input resolving into clarity without baked-in text.
- Middle frame should support the three spoken steps; ensure the three labels are rebuilt as real captions.
- End card must retain exact brand string **DUNG - AI**, use safe margins, and remain legible on an iPhone-sized display.
- Do not publish any asset carrying a third-party watermark until usage and removal rights are established.

## Production blockers

- The supplied MP4 contains an audio stream, but the actual speech has not been independently transcribed or accepted.
- User's selected reference voice remains PocketPal / Supertonic Alex (Male 1), Vietnamese, Quality 5; user described that voice setting as natural. This does not verify the supplied MP4's narration.
- Free Magnific voice generation quota was exhausted at the time checked; no credits were charged. Do not retry or upgrade.
- No free video-render capability was verified in the connected creative workspace.
- SRT timestamps are provisional and cannot be synchronized until the spoken words are reliably established.
- Watermark rights and the end-card/subtitle layout remain unresolved.

## Next acceptance steps

1. Establish a reliable Vietnamese transcript from the existing audio without sending the private MP4 to a paid or credit-based service.
2. Correct and retime subtitles against the actual spoken words; check Vietnamese diacritics, line breaks, reading speed, and safe-area placement.
3. Replace watermarked footage only with original visuals or assets whose license explicitly permits the intended use.
4. Rebuild the end card using exact **DUNG - AI** branding and safe margins.
5. Review the complete export on an iPhone-sized screen with sound and captions enabled.
6. Obtain explicit release approval before public posting.

## Release status

Keep PR in Draft. The supplied MP4 is a review sample only and is **not releasable** at this stage. No merge, production deployment, or public publishing. This document does not modify Worker Production, DNS, D1, secrets, or public site content.
