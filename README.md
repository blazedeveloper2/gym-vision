# Gym Vision

An AI body camera that runs in your browser. It gives live full-body tracking, a body-part identifier, body measurements to track growth, and form feedback for 8 exercises. It installs to your phone's home screen, and all processing happens on your device.

**Live app:** https://blazedeveloper2.github.io/gym-vision/

## What it does

### Body Scan
- **Skeleton:** 33 tracked points.
- **Body outline:** a glowing outline of your whole silhouette.
- **Body parts:** colours each region of your body.
- **Identifier:** tap or drag over your body to name what's under your finger. There are about 100 detailed names, for example:
  - eyes, nose, ears, forehead, jaw
  - front, side and rear delts
  - left and right pecs, sternum, serratus
  - upper and lower abs, obliques
  - traps, lats, rhomboids, lower back, glutes
  - biceps and triceps; inner and outer quads, hamstrings, adductors
  - kneecap vs back of the knee, shin, calf heads, Achilles, heel, toes
  - every finger segment, with Fingers on

  It works out whether you face the camera, face away or stand side-on, so the same spot is named correctly from any angle.
- **Angles:** live elbow, shoulder, hip and knee angles.
- **Fingers:** hand tracking with 21 points per hand.

### Measure
Estimates shoulder width, chest, waist, hips, upper arms (relaxed and flexed), forearms, mid-thighs and calves from your height and your body outline. A guided capture takes the front view, then an optional flex pose and an optional side view. Each result is averaged over about 36 frames and shown with ± uncertainty. Results are saved to a history with trends and CSV export.

### Exercises
Each exercise counts reps (or times the hold) and gives live form cues:

| Exercise | Checks |
| --- | --- |
| Push-ups | depth, hip sag or pike, lockout, tempo |
| Squats | depth (half, parallel or deep), forward lean, knees caving in |
| Lunges | front-knee depth, upright torso |
| Bicep curls | full range, elbow swing, body sway |
| Shoulder press | lockout, even arms, leaning back |
| Lateral raises | shoulder height, bent elbows, even arms |
| Jumping jacks | hands overhead, feet wide |
| Plank | hold timer, hip sag or pike, form % |

**Video mode** analyzes a clip you recorded, with slow-motion playback, so it also works on a PC with no camera.

## Using it on iPhone

1. Open the live link in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open Gym Vision from the home screen and pick a tool.

Each exercise shows its own camera setup. In general:
- **Push-ups and plank:** phone on the floor, side-on.
- **Everything else:** phone about 2–3 m away at hip or chest height.

The back ultra-wide camera (in Settings) makes it easier to fit your whole body in frame.

## How it's fast

- **Each frame processed once:** `requestVideoFrameCallback` runs the pipeline exactly once per camera frame, at 60 fps where the camera supports it.
- **Fast model by default:** MediaPipe Pose Lite runs on the GPU and falls back to the CPU if needed.
- **Shared GPU context:** the WebGL renderer shares its context with MediaPipe, so the segmentation mask never leaves the GPU. Outline and body-part colouring are one fragment-shader pass.
- **No lag:** the renderer draws the exact frame that was analyzed, so the skeleton doesn't trail behind the video.
- **Instant start:** the model downloads and warms up while you're on the home screen.

## How it works

- **Exercise engine** ([`js/exercises/base.js`](js/exercises/base.js)):
  - Each exercise maps a frame to *progress*: 0 is the start position and 1 is the target, such as push-up depth.
  - The shared engine turns progress into reps and handles form faults, which must last about 0.35 s before they're flagged.
  - It flags reps that don't return to the start position.
  - Push-ups also require your shoulders to rise before a rep ends, so hand-release push-ups don't double count.
- **Body parts** ([`js/body/parts.js`](js/body/parts.js)):
  - Regions are capsules built from pose landmarks, assigned per pixel inside the body mask.
  - Detailed names come from each point's position within its region (along the limb, inner or outer, front or back half), plus which way you face. Face and finger landmarks are used where they're available.
- **Measurements** ([`js/body/measure.js`](js/body/measure.js)):
  - Sub-pixel edge detection across the segmentation mask, scaled by your height (head top to soles).
  - Limb circumference is estimated as π × width. Torso circumference uses an ellipse from the front width and the side depth.

## Run locally

It's a static site with no build step:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. The camera works on `localhost`. Your phone needs HTTPS, so use the live link there.

## Tests

```bash
node --test
```

There are 55 tests, and none need a camera:
- every exercise, driven by a small 3D body model filmed from the front, side or back
- measurements on a synthetic silhouette with known sizes
- the body-part identifier from every angle
- regression checks on pose data recorded from real workout videos (see [`tests/fixtures`](tests/fixtures/README.md))

## Project layout

```
index.html                 App shell (home, session, dialogs)
css/styles.css             Styles
js/app.js                  Views, session lifecycle, per-frame pipeline
js/engine.js               MediaPipe pose + hand landmarkers
js/camera.js               Camera / video source and frame loop
js/render/gl.js            WebGL stage: video, outline, body-part shading
js/render/overlay.js       2D overlay: skeleton, labels, guides
js/body/parts.js           Body-part regions and detailed identifier
js/body/measure.js         Measurements from the segmentation mask
js/body/history.js         Saved measurement history
js/exercises/*.js          Exercise engine and the 8 exercises
js/ui/*.js                 Home, Body Scan, exercise and Measure views, settings
tests/                     Tests, 3D test body, recorded fixtures
```

## Privacy

Everything runs on your device, and no camera images are sent anywhere. The MediaPipe library may send anonymous performance metrics to Google, as described in its [privacy notice](https://www.npmjs.com/package/@mediapipe/tasks-vision). Measurements are stored only in your browser.

## License

[MIT](LICENSE). Pose tracking uses [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Apache 2.0).
