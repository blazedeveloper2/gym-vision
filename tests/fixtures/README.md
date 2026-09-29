# Recorded pose fixtures

These are MediaPipe pose landmarks sampled at 10 fps from public workout videos on Wikimedia Commons. They were recorded with both the `lite` and `full` pose models and are used by `tests/realvideo.test.js` and `tests/crosscheck.test.js`. Only landmark coordinates are stored, not the videos themselves.

| Fixture | Source | Licence | Expected |
| --- | --- | --- | --- |
| `pushup_army_hrp.*` | [Army Combat Fitness Test – Hand-Release Push-Up](https://commons.wikimedia.org/wiki/File:Army_Combat_Fitness_Test-_Hand-Release_Push-Up_(HRP)_(Event_3).webm), U.S. Army | Public domain | 6 push-ups |
| `squat_demo_rear.*` | [Squat – exercise demonstration video](https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm), FitnessScape | CC BY 3.0 | 2 squats |
| `squat_kettlebell_side.*` | [Kettlebell Racked Squats (side view)](https://commons.wikimedia.org/wiki/File:Kettlebell_Racked_Squats_(side_view).webm), Taco Fleur | CC BY-SA 4.0 | 6 squats |
| `pullup_demo.*` | [Pull-ups – exercise demonstration video](https://commons.wikimedia.org/wiki/File:Pull-ups_-_exercise_demonstration_video.webm), FitnessScape | CC BY 3.0 | 2 pull-ups (a third is cut off by the end of the clip) |
| `shoulder_press_demo.*` | [Shoulder press – exercise demonstration video](https://commons.wikimedia.org/wiki/File:Shoulder_press_-_exercise_demonstration_video.webm), FitnessScape | CC BY 3.0 | 1 press (the clip starts at lockout and ends at the top of the second) |
| `bench_press_demo.*` | [Bench press – exercise demonstration video](https://commons.wikimedia.org/wiki/File:Bench_press_-_exercise_demonstration_video.webm), FitnessScape | CC BY 3.0 | 2 bench presses, filmed from above at 3/4 (not the side-on set-up the app asks for) |
| `incline_press_demo.*` | [Incline press – exercise demonstration video](https://commons.wikimedia.org/wiki/File:Incline_press_-_exercise_demonstration_video.webm), FitnessScape | CC BY 3.0 | 2 incline presses, filmed from the front: must not count as shoulder presses |
| `db_bench_side.*` | [Dumbbell bench press and dumbbell incline bench press](https://commons.wikimedia.org/wiki/File:Video_showing_how_to_perform_the_dumbbell_bench_press_and_the_dumbbell_incline_bench_press.webm), 38.4–42.6 s, Gantner626 | CC BY-SA 4.0 | Side-on flat dumbbell press: pressed up from the chest and lowered again, no complete rep |
| `db_bench_close.*` | Same video, 52.4–60 s | CC BY-SA 4.0 | 1 flat dumbbell press filmed close up (hips at the edge of the picture, the weights hide the wrists at the bottom) |
| `deadlift_demo.*` | [Deadlift – exercise demonstration video](https://commons.wikimedia.org/wiki/File:Deadlift_-_exercise_demonstration_video.webm), FitnessScape | CC BY 3.0 | 1 deadlift from the floor, filmed from behind at 3/4 |

Each derived landmark file is shared under the same licence as its source video.

Format: gzip'd JSON `{fps, w, h, frames}`, where each frame is `null` or `{l: [x, y, z, visibility] × 33, g: [x, y, z] × 33}`. `l` holds the normalized image landmarks and `g` the world landmarks in metres.
