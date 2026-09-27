# Recorded pose fixtures

These are MediaPipe pose landmarks sampled at 10 fps from public workout videos on Wikimedia Commons. They were recorded with both the `lite` and `full` pose models and are used by `tests/realvideo.test.js`. Only landmark coordinates are stored, not the videos themselves.

| Fixture | Source | Licence | Expected |
| --- | --- | --- | --- |
| `pushup_army_hrp.*` | [Army Combat Fitness Test – Hand-Release Push-Up](https://commons.wikimedia.org/wiki/File:Army_Combat_Fitness_Test-_Hand-Release_Push-Up_(HRP)_(Event_3).webm), U.S. Army | Public domain | 6 push-ups |
| `squat_demo_rear.*` | [Squat – exercise demonstration video](https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm), FitnessScience | CC BY 3.0 | 2 squats |
| `squat_kettlebell_side.*` | [Kettlebell Racked Squats (side view)](https://commons.wikimedia.org/wiki/File:Kettlebell_Racked_Squats_(side_view).webm), Taco Fleur | CC BY-SA 4.0 | 6 squats |

Each derived landmark file is shared under the same licence as its source video.

Format: gzip'd JSON `{fps, w, h, frames}`, where each frame is `null` or `{l: [x, y, z, visibility] × 33, g: [x, y, z] × 33}`. `l` holds the normalized image landmarks and `g` the world landmarks in metres.
