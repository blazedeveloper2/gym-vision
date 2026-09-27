# Gym Technique Helper

A web app that tracks your body through the camera and gives live feedback on exercise technique. It installs to your phone's home screen and runs entirely on your device, so no video is ever uploaded.

**Live app:** https://blazedeveloper2.github.io/gym-technique-helper/

## Features

- **Tracker mode:** draws a full-body skeleton (33 landmarks) over the live camera feed. It shows elbow, shoulder, hip and knee angles for both sides, and can optionally track individual fingers.
- **Push-up mode:**
  - counts reps automatically
  - shows how deep you go (a depth % and the elbow angle)
  - checks your body line for sagging or piked hips and whether you lock out at the top
  - records the tempo of each rep
  - can read out rep counts and form cues
- **Squat mode:**
  - counts reps and checks you reach the depth target (half squat, parallel, or below parallel)
  - side-on, it flags too much forward lean
  - facing the camera, it flags knees caving in
- **Video mode:** analyzes a clip you recorded earlier, with slow-motion playback. This also works on a PC with no camera.
- **Installable (PWA):** add it to your home screen for a full-screen, app-like experience. After the first load it works offline.

## Using it on iPhone

1. Open the live app link in **Safari**.
2. Tap **Share** and then **Add to Home Screen**.
3. Open it from the home screen and tap **Start camera**. Allow camera access.

Camera setup:

- **Push-ups:** phone in **landscape on the floor about 2 m away**, side-on to you, with your whole body in frame.
- **Squats:** phone propped up at about **hip height, 2–3 m away**. Film side-on to check depth and back angle, or facing you to check your knees.

Using the back ultra-wide camera (in Settings) makes it easier to fit everything in.

> **What about the iPhone's LiDAR / TrueDepth camera?** Browsers only get normal color video, not the depth sensors. MediaPipe estimates 3D positions from the regular image instead (the *3D* angle option). Using the LiDAR would require a native iOS app with ARKit, which is a possible future step.

## How it works

- **Pose tracking:** [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) runs in the browser using WebAssembly and WebGL. It gives 33 body landmarks per frame, both as image coordinates and as estimated 3D world coordinates.
- **Joint angles:** each angle is measured at the middle joint of three landmarks (for example shoulder → elbow → wrist). In *2D* mode the angle is measured as the camera sees it. In *3D* mode it uses MediaPipe's estimated depth.
- **Push-up logic** ([`js/exercises/pushup.js`](js/exercises/pushup.js)):
  - Depth comes from the elbow angle: around 160° means straight arms and the target (90° by default, adjustable) means full depth.
  - A rep starts when the elbow bends below 140° and finishes when it straightens above 150°. It only counts if you reached the depth target.
  - Body line is the shoulder → hip → ankle angle. Whether the hip is below or above the shoulder–ankle line tells a sag from a pike. A fault has to last 0.4 s before it's flagged.
  - A straightened elbow only finishes a rep if the shoulders have also risen back up. This stops hand-release push-ups (lifting your hands at the bottom) from counting twice.
- **Squat logic** ([`js/exercises/squat.js`](js/exercises/squat.js)):
  - Depth compares hip height to knee height, scaled by thigh length measured while you stand, so it works from the side or the front. 100% means hips level with the knees (parallel).
  - The app detects whether you're side-on or facing the camera by how far apart your shoulders appear.
  - Side-on, it checks torso lean (flagged beyond 50° from vertical). Facing the camera, it checks knee width against ankle width to spot knees caving in.

## Run locally

It's a static site with no build step:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. The camera works on `localhost`. Other devices on your network need HTTPS, so use the GitHub Pages link on your phone.

## Tests

The rep counters are tested with generated poses (clean reps, shallow reps, sagging hips, forward lean, caving knees and so on). No camera is needed:

```bash
node --test
```

## Project layout

```
index.html              App shell
css/styles.css          Styles
js/app.js               Camera/video input, main loop, UI
js/pose.js              MediaPipe model loading (GPU with CPU fallback)
js/geometry.js          Landmark indices, angle maths, smoothing
js/draw.js              Skeleton and label rendering
js/exercises/pushup.js  Push-up rep counter and form checks
js/exercises/squat.js   Squat rep counter and form checks
js/voice.js             Spoken feedback
sw.js                   Offline cache
tests/                  Rep counter tests with generated poses
```

## Roadmap ideas

- More exercises: lunges, overhead press, pull-ups
- Rep history and progress over time
- Elbow flare and head position checks for push-ups; heel lift checks for squats
- A native iOS version using ARKit and LiDAR body tracking

## Privacy

All processing happens on your device. The MediaPipe library may send anonymous performance metrics to Google, as described in its [privacy notice](https://www.npmjs.com/package/@mediapipe/tasks-vision). Your camera images are never sent.

## License

[MIT](LICENSE). Pose tracking uses [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Apache 2.0).
