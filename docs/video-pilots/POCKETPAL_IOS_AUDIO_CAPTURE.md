# PocketPal iPhone audio capture — zero-cost test

## Purpose

Capture a short test of the user-confirmed PocketPal TTS voice (Alex / Male 1, Vietnamese, Quality 5) without a paid service or another app. This is a capture experiment, not a confirmed PocketPal export feature.

## Important limitation

PocketPal's public App Store release notes describe neural TTS (including Supertonic) and Markdown chat export, but do not document a dedicated export of generated TTS audio. Do not assume an audio-export button exists.

iOS Screen Recording can save a screen recording to Photos and can include audio. Apple notes that some apps may prevent recording their content. Therefore, whether PocketPal's generated voice is captured must be tested on the installed app.

## Short test on iPhone

1. Open PocketPal and prepare a short Vietnamese sentence (about 5–10 seconds).
2. Swipe down from the top-right corner to open Control Center.
3. Touch and hold the Screen Recording control.
4. Turn Microphone on, then tap Start Recording. Wait for the three-second countdown.
5. Return to PocketPal and play the short TTS sample once. Avoid notifications or other audio during the test.
6. Stop recording using the red recording indicator at the top of the screen, then open Photos.
7. Play the saved screen recording and check whether the TTS voice is audible and clear.

## Pass / fail

- PASS: The saved recording contains the PocketPal voice clearly. Keep the original recording; it can be trimmed or processed later.
- FAIL: The recording is silent or captures only room noise / microphone audio. Do not repeat long takes. This may be an app/iOS capture restriction; use another already-available export method only if PocketPal visibly offers one.

## Privacy and cost

- Keep the recording local in Photos until the user chooses to share it.
- Do not upload private conversations or unrelated screen content.
- No paid TTS, subscription, API key, or billing setup.
- No claim that this method extracts a standalone audio file; the first output is a screen-recording video.

## Sources

- Apple Support, “Take a screen recording on iPhone”: https://support.apple.com/en-ie/guide/iphone/iph52f6e1987/ios
- PocketPal AI App Store listing and version history: https://apps.apple.com/vn/app/pocketpal-ai/id6502579498
