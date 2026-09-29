# Gym Vision

An AI body camera that runs in your browser. It gives live full-body tracking, a body-part identifier, body measurements to track growth, and rep counting with spoken form feedback for 88 exercises: your own weekly training program plus 8 general exercises. It installs to your phone's home screen, and all processing happens on your device.

**Live app:** https://blazedeveloper2.github.io/gym-vision/

## What it does

### Body Scan
- **Skeleton:** 33 tracked points.
- **Body outline:** a glowing outline of your whole silhouette.
- **Body parts:** colours your body as detailed anatomy, each part with its own colour and label. That's up to about 100 parts at once, for example:
  - face: forehead, eyebrows, eyes, temples, nose, cheeks, mouth, chin, jaw, ears
  - neck: throat (Adam's apple), sides of the neck, back of the neck
  - chest: collarbones, upper chest, pecs or breasts, nipples, sternum, lower chest, serratus, armpits
  - core: upper, middle and lower abs, belly button, obliques, V-line, hip bones, hip flexors
  - back: upper and mid traps, rhomboids, rotator cuff, teres major, lats, spine, lower back, QL
  - hips: glutes, glute medius, tailbone, gluteal cleft, glute folds; the genital area, perineum and anus
  - arms: front, side and rear delts, biceps, brachialis, triceps heads, brachioradialis, forearm flexors and extensors
  - legs: quads (rectus femoris, outer quad, VMO teardrop), inner thigh, TFL, IT band, hamstrings, kneecaps, shins, peroneals, calf heads, soleus, Achilles, heels, arches, toes
  - hands (with Fingers on): every finger bone, knuckles, palm or back of the hand, thumb pad
  - joints: shoulders, elbows, wrists, hips, knees and ankles

  Which parts show depends on whether you face the camera, face away or stand side-on. With your sex set in Settings, the chest, throat and genital area use sex-specific anatomical names. It keeps working close up: with your hips or legs out of frame, with only your face in view, or with the back camera pointed at just a leg or an arm. It works even when you look down at your own legs and they appear upside down.
- **Identifier:** tap or drag over your body to name what's under your finger. It uses the same map as the colouring, so the name always matches the colour. Every point inside your outline has a name.
- **Angles:** live elbow, shoulder, hip and knee angles.
- **Fingers:** hand tracking with 21 points per hand. Each hand is zoomed in on before tracking, so fingers stay accurate from across the room, and the body outline traces your actual fingers.

### Measure
Estimates shoulder width, chest, waist, hips, upper arms (relaxed and flexed), forearms, mid-thighs and calves from your height and your body outline. A guided capture takes the front view, then an optional flex pose and an optional side view. Each capture takes about 1.5 seconds, is averaged over up to 20 frames and is shown with ± uncertainty. Arms held close to the body aren't counted as chest or waist, and it tells you if your head or feet are cut off. Results are saved to a history with trends and CSV export.

### Exercises
Each exercise counts reps (or times the hold), gives live form cues on screen and speaks them. The home screen has two sections, plus a search box that finds any exercise by name:

- **My workouts:** the weekly program from the Bartleby gym app (Edrin's plan). Each day lists its exercises in order with sets × reps, and today's day opens first.
  - **Alternates** follow your equipment (Settings → Your equipment: pull-up bar, ab wheel, barbell). Without a bar you get the no-bar version, for example.
  - **Skill ladders** (handstand, planche, front lever, push-up and handstand push-up progressions, rollouts, hollow and arch work) show the step you're on and what the next step needs. Tap **Skill levels** to move up or down a step.
  - Your equipment and ladder steps are read once from the Bartleby app when both run on the same site. Gym Vision never writes to Bartleby's data.
- **General exercises:** push-ups, squats, lunges, bicep curls, shoulder press, lateral raises, jumping jacks and plank.

Each exercise shows its camera setup and what counts before you start. Before your first rep, the voice reads out anything you need to fix, such as "Turn side on to the camera" or "Hang from the bar".

#### What makes a rep count
The goal is that you can't cheat a rep:
- **Full range:** a rep has to reach the target (chin over the bar, dumbbells to the chest) and come all the way back (dead hang, straight arms). Half reps don't count.
- **Start position:** a rep only starts once you've been seen in the start position. You can't jump to the top of a pull-up and lower down for a rep.
- **The right body part has to move:** in a pull-up the body rises to the bar; in a row the hand comes up from a hang while the torso stays still. Relative to the body, a pull-up looks like a shoulder press, but the hands stay on the bar, so it doesn't count as one.
- **The right posture:** lying on a bench with your arms up isn't a preacher curl or a hang, and leaning back on an incline bench isn't a shoulder press. Exercises that need a side view ask you to turn when they see you head-on.
- **Two signals, not one:** depth needs the dumbbells low *and* the elbows bent, so one misread wrist can't fake a rep.
- **Tempo:** negatives must be slow, and some exercises need a pause.

A rep that doesn't count tells you why, on screen and out loud, for example "Not counted — keep your hands on the bar and pull your body up".

#### General exercises

| Exercise | Checks |
| --- | --- |
| Push-ups | depth, hip sag or pike, lockout, tempo; the chest has to go down, not just the elbows bend |
| Squats | depth (half, parallel or deep), forward lean, knees caving in; the knees have to bend |
| Lunges | front-knee depth, upright torso; the feet must be split and the hips have to drop |
| Bicep curls | full range, elbow swing, leaning back; raising the elbow forward doesn't count |
| Shoulder press | lockout, even arms, leaning back; the weights have to travel, sitting or standing tall |
| Lateral raises | shoulder height, bent elbows, even arms; raising the arms forward or overhead doesn't count |
| Jumping jacks | hands overhead and feet wide, both required; both feet must leave the floor (stepping out doesn't count) |
| Plank | hold timer, hip sag or pike, form %; the timer pauses with your hips on the floor or knees down |

#### Program exercises

| Group | Exercises | What's checked |
| --- | --- | --- |
| Chest | dumbbell bench and incline press, flyes | depth with bent elbows, lockout, elbow flare, hips on the bench, bench angle, controlled lowering; bending the elbows in a fly turns it into a press and doesn't count |
| Arms | overhead triceps extensions, preacher, hammer and incline curls, wrist and reverse wrist curls | full range, elbows up or on the pad, shoulders back; lifting the upper arm off the pad or the forearms off the bench doesn't count |
| Back | pull-ups, chin-ups, single-arm and chest-supported rows, pullovers, reverse flyes, reverse snow angels | dead hang to chin over the bar, no kipping or craning; the hand rows up from a hang with the torso still; fixed elbows in pullovers and flyes |
| Legs | Bulgarian split squats, heel-elevated front and goblet squats, RDLs, hip thrusts, leg curls, calf raises | depth, rear foot up, hinge not squat, full hip extension without arching, hips down, straight legs and a pause in calf raises |
| Core | dead bugs, crunches, reverse crunches, hanging leg raises, side plank reach-throughs, rollouts, hollow and arch holds and rocks, reverse hypers | range and body shape; legs past level without swinging; rollouts to full extension with straight arms and no sag |
| Skills | handstands, kick-ups, straddle press, frog stands, planches, front levers, scapular pulls and push-ups, wrist rocks | hold timers that pause when the shape breaks (hips level, legs straight, arms locked); kick-up attempts are counted |
| Push-up and HSPU ladders | diamond, decline, archer and one-arm push-ups, pike and elevated pike push-ups, wall, deficit and freestanding handstand push-ups, negatives | depth and lockout; hands together for diamonds, one arm straight for archers, feet up for declines, head to the floor for HSPUs, slow negatives |

**Video mode** analyzes a clip you recorded, with slow-motion playback, so it also works on a PC with no camera.

## Using it on iPhone

1. Open the live link in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open Gym Vision from the home screen and pick a tool.

In **Settings → Your profile** you can set your sex, height and weight. Height is used for measurements; sex picks the anatomical names in Body Scan.

Each exercise shows its own camera setup. In general:
- **Push-ups, plank and floor work:** phone on the floor, side-on.
- **Bench exercises:** phone at bench height, about 2 m away, side-on.
- **Everything else:** phone about 2–3 m away at hip or chest height. Most program exercises need a side view.
- **Small movements** (calf raises, wrist curls, scapular pulls and push-ups) move only a few centimetres, so put the phone closer. The app tells you if it needs a bigger view.

The back ultra-wide camera (in Settings) makes it easier to fit your whole body in frame.

## How it's fast

- **Each frame processed once:** `requestVideoFrameCallback` runs the pipeline exactly once per camera frame, at 60 fps where the camera supports it.
- **Fast model by default:** MediaPipe Pose Lite runs on the GPU and falls back to the CPU if needed.
- **Shared GPU context:** the WebGL renderer shares its context with MediaPipe, so the segmentation mask never leaves the GPU. Outline and body-part colouring are one fragment-shader pass.
- **No lag:** the renderer draws the exact frame that was analyzed, so the skeleton doesn't trail behind the video.
- **Instant start:** the model downloads and warms up while you're on the home screen.
- **Close-ups:** MediaPipe's pose detector finds people by their face, so it can't find a leg on its own. When no face or shoulder is in view, Body Scan switches to [MoveNet](https://www.tensorflow.org/hub/tutorials/movenet) (TensorFlow.js), which needs no face, plus MediaPipe's selfie segmenter for the outline. MoveNet also tries other rotations when a view looks upside down. Close-up joints are only used when they sit on the body outline and hang together (no parts on an empty bed), and joints, front/back and labels are smoothed and held so they don't flicker. On real clips cropped to just the legs, it found the hips, knees and ankles in 70–97% of frames, while MediaPipe found them in 0–25%.

## How it works

- **Exercise engine** ([`js/exercises/base.js`](js/exercises/base.js)):
  - Each exercise maps a frame to *progress*: 0 is the start position and 1 is the target, such as push-up depth.
  - The shared engine turns progress into reps and handles form faults, which must last about 0.35 s before they're flagged.
  - Reps must start in the start position and return to it. Each exercise adds its own anti-cheat checks (`repBlocks`), and tempo rules cover slow negatives and pauses.
  - Holds time only while the shape is held, with a grace period for a wobble.
  - Push-ups also require your shoulders to rise before a rep ends, so hand-release push-ups don't double count.
- **Measuring kit** ([`js/exercises/kit.js`](js/exercises/kit.js)): heights are measured in arm or torso lengths, so they read the same close up or far away. It also works out which way your chest faces (from the face, bent knees and toes), so it still works lying on a bench with your head hanging back.
- **Program** ([`js/program.js`](js/program.js)): the weekly plan, skill ladders and equipment alternates.
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

There are 220 tests, and none need a camera:
- every exercise, driven by a small 3D body model filmed from the front, side or back, including cheats that must not count (half reps, kipping, swinging, lifting off the pad)
- measurements on a synthetic silhouette with known sizes
- the body-part identifier from every angle
- regression checks on pose data recorded from real workout videos (see [`tests/fixtures`](tests/fixtures/README.md))
- a cross-check that runs all 88 exercises over every recorded clip: nothing may count reps that aren't there

## Project layout

```
index.html                 App shell (home, session, dialogs)
css/styles.css             Styles
js/app.js                  Views, session lifecycle, per-frame pipeline
js/engine.js               MediaPipe pose + hand landmarkers, selfie segmenter
js/limbs.js                Close-up joint finder (MoveNet) for leg/arm-only views
js/tracker.js              Picks MediaPipe or close-up tracking per frame; body checks and smoothing
models/movenet-lightning/  MoveNet SinglePose Lightning v4 (TF.js, Apache 2.0)
js/camera.js               Camera / video source and frame loop
js/render/gl.js            WebGL stage: video, outline, body-part shading
js/render/overlay.js       2D overlay: skeleton, labels, guides
js/body/parts.js           Body-part regions and detailed identifier
js/body/measure.js         Measurements from the segmentation mask
js/body/history.js         Saved measurement history
js/exercises/*.js          Exercise engine, measuring kit and the 88 exercises
js/program.js              Weekly program, skill ladders, equipment alternates
js/ui/*.js                 Home, Body Scan, exercise and Measure views, settings
tests/                     Tests, 3D test body, recorded fixtures
```

## Privacy

Everything runs on your device, and no camera images are sent anywhere. The MediaPipe library may send anonymous performance metrics to Google, as described in its [privacy notice](https://www.npmjs.com/package/@mediapipe/tasks-vision). Measurements are stored only in your browser.

## License

[MIT](LICENSE). Pose tracking uses [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Apache 2.0). Close-up tracking uses [MoveNet](https://www.kaggle.com/models/google/movenet) and [TensorFlow.js](https://github.com/tensorflow/tfjs) (both Apache 2.0).
