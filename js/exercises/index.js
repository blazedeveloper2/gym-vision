import { PushupAnalyzer } from './pushup.js';
import { SquatAnalyzer } from './squat.js';
import { LungeAnalyzer } from './lunge.js';
import { CurlAnalyzer } from './curl.js';
import { PressAnalyzer } from './press.js';
import { LateralRaiseAnalyzer } from './lateral.js';
import { JacksAnalyzer } from './jacks.js';
import { PlankAnalyzer } from './plank.js';
import { BenchPressAnalyzer, FlyAnalyzer, PulloverAnalyzer } from './bench.js';
import { PreacherCurlAnalyzer, InclineCurlAnalyzer, OverheadExtensionAnalyzer, WristCurlAnalyzer } from './arms.js';
import { RowAnalyzer, RearFlyAnalyzer, SnowAngelAnalyzer } from './back.js';
import { PullUpAnalyzer, ScapPullAnalyzer, ArchHangAnalyzer, HangingLegRaiseAnalyzer } from './hang.js';
import { SplitSquatAnalyzer, HingeAnalyzer, HipThrustAnalyzer, LegCurlAnalyzer, CalfRaiseAnalyzer } from './legs.js';
import { DeadBugAnalyzer, CrunchAnalyzer, ReverseCrunchAnalyzer, SidePlankReachAnalyzer, RolloutAnalyzer, RockAnalyzer, ReverseHyperAnalyzer } from './core.js';
import { HandstandHold, PlancheHold, LeverHold, HollowHold, ArchHold } from './holds.js';
import { PushVariantAnalyzer, PikePushupAnalyzer, HSPUAnalyzer, ScapPushupAnalyzer, WristRockAnalyzer, StraddlePressAnalyzer } from './calis.js';

/**
 * Exercise catalog. `create(settings)` builds the analyzer; `options(settings)`
 * re-applies settings that can change mid-session.
 *
 * - setup: where the phone goes and how to start (shown until you're in position)
 * - checks: what has to happen for a rep to count, and what it calls out
 *
 * GENERAL is the everyday list; the rest are the exercises in your program
 * (js/program.js), each set up for exactly that variant.
 */

const SIDE = 'Side view';
const FRONT = 'Front view';
const EITHER = 'Side or front';

// Phone placement, reused.
const PHONE = {
  bench: 'Phone at bench height, about 2 m away, level with your chest.',
  floor: 'Put your phone on the floor in landscape, about 2 m away.',
  standing: 'Prop your phone at hip height, 2–3 m away.',
  chest: 'Prop your phone at chest height, about 2 m away.',
  bar: 'Prop your phone 3 m or more away so the bar and your feet both fit.',
  head: 'Phone on the floor in front of your head, about 1.5 m away, facing you.',
};

export const GENERAL = [
  {
    id: 'pushup',
    name: 'Push-ups',
    blurb: 'Depth, hip sag and lockout',
    view: SIDE,
    muscles: 'Chest, Triceps, Front Delts, Serratus Anterior, Core',
    setup: [PHONE.floor, 'Set up side-on so your whole body is in frame.', 'Get into a plank. Reps count automatically.'],
    checks: ['Counts when your elbows reach the depth target and your chest really goes down.', 'Calls out sagging or piked hips.'],
    create: (s) => new PushupAnalyzer({ depthTarget: s.depthTarget }),
    options: (s) => ({ depthTarget: s.depthTarget }),
  },
  {
    id: 'squat',
    name: 'Squats',
    blurb: 'Depth, forward lean and knees',
    view: EITHER,
    muscles: 'Quads, Glutes, Adductors',
    setup: [PHONE.standing, 'Side-on checks depth and lean. Facing the camera checks your knees.', 'Stand tall. Reps count automatically.'],
    checks: ['Counts when your hips reach the depth target and your knees bend.', 'Calls out leaning forward and knees caving in.'],
    create: (s) => new SquatAnalyzer({ depthTarget: s.squatDepth }),
    options: (s) => ({ depthTarget: s.squatDepth }),
  },
  {
    id: 'lunge',
    name: 'Lunges',
    blurb: 'Knee depth and upright torso',
    view: SIDE,
    muscles: 'Quads, Glutes, Adductors',
    setup: [PHONE.standing, 'Stand side-on with room to step forward or back.', 'Lower until your front knee is at about 90°.'],
    checks: ['Counts when the front knee reaches ~90° and your hips drop.', 'Calls out leaning forward.'],
    create: () => new LungeAnalyzer(),
  },
  {
    id: 'curl',
    name: 'Bicep curls',
    blurb: 'Full range and elbow swing',
    view: EITHER,
    muscles: 'Biceps, Brachialis',
    setup: [PHONE.chest, 'Side-on shows elbow swing best; facing works too.', 'Start with your arms straight down.'],
    checks: ['Counts full curls from straight arms.', 'Calls out elbows drifting forward or back, and body swing.'],
    create: () => new CurlAnalyzer(),
  },
  {
    id: 'press',
    name: 'Shoulder press',
    blurb: 'Lockout and even arms',
    view: FRONT,
    muscles: 'Front Delts, Side Delts, Triceps',
    setup: [PHONE.chest + ' Face it.', 'Start with the weights at your shoulders.', 'Press until your arms are straight overhead.'],
    checks: ['Counts presses from the shoulders to straight arms.', 'Calls out uneven arms.'],
    create: () => new PressAnalyzer(),
  },
  {
    id: 'lateral',
    name: 'Lateral raises',
    blurb: 'Shoulder height and even arms',
    view: FRONT,
    muscles: 'Side Delts',
    setup: [PHONE.chest + ' Face it.', 'Arms at your sides with a slight bend in the elbows.', 'Raise to shoulder height, then lower slowly.'],
    checks: ['Counts raises to shoulder height, out to the sides (front raises don’t count).', 'Calls out going too high, bent elbows and uneven arms.'],
    create: () => new LateralRaiseAnalyzer(),
  },
  {
    id: 'jacks',
    name: 'Jumping jacks',
    blurb: 'Full spread every rep',
    view: FRONT,
    muscles: 'Cardio',
    setup: [PHONE.standing + ' Face it.', 'Check your hands stay in frame when overhead.', 'Start jumping. Reps count automatically.'],
    checks: ['Counts only real jumps with hands overhead and feet wide.'],
    create: () => new JacksAnalyzer(),
  },
  {
    id: 'plank',
    name: 'Plank',
    blurb: 'Hold timer and hip line',
    view: SIDE,
    muscles: 'Core',
    setup: [PHONE.floor, 'Set up side-on so your whole body is in frame.', 'Hold a plank. The timer runs while you hold it.'],
    checks: ['Timer pauses with your hips or knees on the floor.', 'Calls out sagging or piked hips.'],
    create: () => new PlankAnalyzer(),
  },
];

/** A program exercise; `fig` defaults to the family's figure. */
const ex = (id, name, fig, view, blurb, muscles, setup, checks, create, extra = {}) => ({ id, name, fig, view, blurb, muscles, setup, checks, create, ...extra });

const pushOpts = (s) => ({ depthTarget: s.depthTarget });

export const PROGRAM_EXERCISES = [
  // ---------------- chest & shoulders
  ex('incline-press', 'Incline Dumbbell Press', 'bench-incline', SIDE, 'Depth, lockout and elbow flare', 'Upper Chest, Front Delts, Triceps',
    ['Bench at 30°. ' + PHONE.bench, 'Lie back side-on, pressing arm nearest the camera.', 'Press to straight arms to start.'],
    ['Counts when the dumbbells come down to your chest and go back up to straight arms.', 'Calls out flared elbows, hips coming off the bench and dropping the weights.'],
    () => new BenchPressAnalyzer({ bench: 'incline' })),
  ex('bench-press', 'Dumbbell Bench Press', 'bench', SIDE, 'Depth, lockout and elbow flare', 'Chest, Triceps, Front Delts',
    ['Flat bench. ' + PHONE.bench, 'Lie back side-on, pressing arm nearest the camera.', 'Press to straight arms to start.'],
    ['Counts when the dumbbells come down to your chest and go back up to straight arms.', 'Calls out flared elbows, hips coming off the bench and dropping the weights.'],
    () => new BenchPressAnalyzer({ bench: 'flat' })),
  ex('flyes', 'Dumbbell Flyes', 'fly', SIDE, 'Stretch, fixed elbows', 'Chest (stretch focus), Front Delts',
    ['Flat bench. ' + PHONE.bench, 'Lie back side-on, dumbbells over your chest.', 'Keep one soft elbow bend all set.'],
    ['Counts wide arcs down to a full stretch and back.', 'Bending the elbows into a press doesn’t count.', 'Calls out forcing the stretch and dropping into it.'],
    () => new FlyAnalyzer()),
  ex('oh-extension', 'Overhead Tricep Extensions', 'oh-ext', SIDE, 'Deep stretch, elbows up', 'Triceps Long Head, Lateral Head',
    ['Bench back at 85°. ' + PHONE.chest, 'Sit side-on, dumbbell overhead in both hands.', 'Straighten your arms to start.'],
    ['Counts lowering deep behind your head and locking out.', 'Dropping the elbows into a press doesn’t count.', 'Calls out elbows drifting forward and arching off the pad.'],
    () => new OverheadExtensionAnalyzer()),
  // ---------------- arms
  ex('preacher-curl', 'Preacher Curls', 'preacher', SIDE, 'Full range, arm on the pad', 'Biceps Short Head, Brachialis',
    ['Bench back at 45°. ' + PHONE.chest, 'Stand behind the bench side-on, working arm nearest the camera.', 'Lower to an almost straight arm to start.'],
    ['Counts curls from an almost straight arm to the forearm upright.', 'Lifting your upper arm off the pad doesn’t count.', 'Calls out dropping the weight at the bottom.'],
    () => new PreacherCurlAnalyzer()),
  ex('hammer-curl', 'Hammer Curls', 'curl', EITHER, 'Full range, still elbows', 'Brachialis, Brachioradialis, Biceps',
    [PHONE.chest, 'Side-on shows elbow drift best; facing works too.', 'Stand tall, arms straight down, palms facing in.'],
    ['Counts full curls from straight arms.', 'Raising the elbow forward doesn’t count.', 'Calls out elbows drifting forward or behind you, and swaying.'],
    () => new CurlAnalyzer({}, { noPerson: 'Stand side-on or facing the camera', ready: 'Ready — curl, thumbs up' })),
  ex('incline-curl', 'Incline Curls', 'incline-curl', SIDE, 'Stretch at the bottom, elbows back', 'Biceps Long Head, Short Head',
    ['Bench at 55°. ' + PHONE.chest, 'Sit back side-on, arms hanging straight down.', 'Head and shoulders on the pad.'],
    ['Counts curls from straight arms, elbows staying back.', 'Swinging the elbows forward doesn’t count.', 'Calls out shoulders coming off the pad.'],
    () => new InclineCurlAnalyzer()),
  ex('wrist-curl', 'Dumbbell Wrist Curls', 'wrist-curl', SIDE, 'Full wrist range, forearms down', 'Wrist Flexors',
    ['Phone at bench height, about 1 m away.', 'Forearms flat on the bench, palms up, hands past the edge, side-on.', 'Let the weight roll down to start.'],
    ['Counts the wrist curling from below the bench line to well above it.', 'Lifting your forearms off the bench doesn’t count.'],
    () => new WristCurlAnalyzer()),
  ex('reverse-wrist-curl', 'Dumbbell Reverse Wrist Curls', 'wrist-curl', SIDE, 'Full wrist range, forearms down', 'Wrist Extensors',
    ['Phone at bench height, about 1 m away.', 'Forearms flat on the bench, palms down, hands past the edge, side-on.', 'Let your knuckles drop to start.'],
    ['Counts the back of the hand lifting from below the bench line to well above it.', 'Lifting your forearms off the bench doesn’t count.'],
    () => new WristCurlAnalyzer({ high: 25 }, { ready: 'Ready — lift the back of your hand', reached: 'Top — pause, then lower slowly' })),
  // ---------------- back
  ex('pull-up', 'Pull-Ups', 'pull-up', EITHER, 'Chin over the bar, dead hang', 'Lats, Biceps, Rhomboids, Forearms',
    [PHONE.bar, 'Front or back view works; side-on too.', 'Hang with straight arms to start.'],
    ['Counts only from a dead hang to chin over the bar and back to straight arms.', 'Kipping, swinging, jumping up and half reps don’t count.', 'Calls out dropping down too fast.'],
    () => new PullUpAnalyzer()),
  ex('chin-up', 'Chin-Ups', 'pull-up', EITHER, 'Chin over the bar, dead hang', 'Lats, Biceps, Rhomboids, Forearms',
    [PHONE.bar, 'Front or side view works.', 'Palms facing you, hang with straight arms to start.'],
    ['Counts only from a dead hang to chin over the bar and back to straight arms.', 'Kipping, swinging, jumping up and half reps don’t count.'],
    () => new PullUpAnalyzer({}, { ready: 'Ready — pull your chin over the bar, palms facing you' })),
  ex('single-arm-row', 'Single-Arm Rows', 'row', SIDE, 'Elbow to the hip, no twist', 'Lats, Rhomboids, Rear Delts, Biceps',
    [PHONE.bench, 'Knee and hand on the bench, rowing arm nearest the camera.', 'Let the dumbbell hang to start.'],
    ['Counts rows from a straight arm up until the elbow reaches your back.', 'A straight-arm swing doesn’t count.', 'Calls out twisting open and pulling toward the shoulder.'],
    () => new RowAnalyzer({ support: 'bench' })),
  ex('cs-row', 'Chest-Supported Rows', 'row-cs', SIDE, 'Chest on the pad, full stretch', 'Lats, Rhomboids, Traps, Rear Delts, Biceps',
    ['Bench at 30–45°. ' + PHONE.bench, 'Lie chest-down side-on, arms hanging.', 'Let the dumbbells hang to start.'],
    ['Counts rows from straight arms until the elbows pass your back.', 'Lifting your chest off the pad to jerk it up doesn’t count.'],
    () => new RowAnalyzer({ support: 'chest' })),
  ex('pullover', 'Dumbbell Pullovers', 'pullover', SIDE, 'Stretch behind the head, fixed elbows', 'Lats, Chest, Serratus Anterior',
    ['Flat bench. ' + PHONE.bench, 'Lie back side-on, dumbbell over your chest.', 'Keep the same slight elbow bend all set.'],
    ['Counts lowering behind your head to a stretch and back over your chest.', 'Bending and straightening the elbows doesn’t count.', 'Calls out arching off the bench.'],
    () => new PulloverAnalyzer()),
  ex('reverse-fly', 'Reverse Flyes', 'rear-fly', SIDE, 'Elbows to shoulder height, wide', 'Rear Delts, Rhomboids, Mid Traps',
    ['Bench at 30°. ' + PHONE.bench, 'Lie chest-down side-on, arms hanging.', 'Soft, fixed elbow bend.'],
    ['Counts raises until your elbows reach shoulder height.', 'Bending the elbows into a row doesn’t count.', 'Calls out lifting your chest and swinging.'],
    () => new RearFlyAnalyzer()),
  ex('snow-angel', 'Reverse Snow Angels', 'snow-angel', SIDE, 'Hips to overhead, arms lifted', 'Rear Delts, Mid Traps, Rhomboids',
    ['Flat bench. ' + PHONE.bench, 'Lie face down side-on, arms by your hips.', 'Lift your arms off the bench to start.'],
    ['Counts full sweeps from your hips to overhead and back.', 'Calls out arms dropping, bent elbows and lifting your chest.'],
    () => new SnowAngelAnalyzer()),
  // ---------------- legs
  ex('bss', 'Bulgarian Split Squats', 'bss', EITHER, 'Depth, hips down, front heel', 'Quads, Glutes, Adductors',
    [PHONE.standing, 'Stand side-on, back foot’s laces on the bench.', 'Facing the camera watches your front knee instead.'],
    ['Counts when the front knee reaches ~95° and your hips really drop (per leg).', 'Calls out folding forward, the front heel lifting and the knee caving in.'],
    () => new SplitSquatAnalyzer()),
  ex('front-squat', 'Heel-Elevated Front Squats', 'front-squat', EITHER, 'Depth, elbows up', 'Quads, Glutes, Core, Erectors',
    [PHONE.standing, 'Side-on checks depth, lean and your elbows; facing checks knees.', 'Heels on plates, bar in the front rack, stand tall.'],
    ['Counts when your hips reach the depth target and your knees bend.', 'Calls out elbows dropping, leaning forward and knees caving in.'],
    (s) => new SquatAnalyzer({ depthTarget: s.squatDepth, hold: 'front', maxLean: 45 }),
    { options: (s) => ({ depthTarget: s.squatDepth }) }),
  ex('goblet-squat', 'Heel-Elevated Goblet Squats', 'goblet', EITHER, 'Depth, dumbbell at the chest', 'Quads, Glutes, Core',
    [PHONE.standing, 'Side-on checks depth, lean and the dumbbell; facing checks knees.', 'Heels on plates, dumbbell against your chest, stand tall.'],
    ['Counts when your hips reach the depth target and your knees bend.', 'Calls out the dumbbell drifting off your chest, leaning and knees caving in.'],
    (s) => new SquatAnalyzer({ depthTarget: s.squatDepth, hold: 'goblet', maxLean: 45 }),
    { options: (s) => ({ depthTarget: s.squatDepth }) }),
  ex('bb-rdl', 'Barbell Romanian Deadlifts', 'rdl', SIDE, 'Hinge to the knees, bar close', 'Hamstrings, Glutes, Erectors',
    [PHONE.standing, 'Stand side-on holding the bar at your thighs.'],
    ['Counts hinging until the bar passes your knees, then standing tall.', 'Squatting it down doesn’t count.', 'Calls out bent knees and the bar drifting off your legs.'],
    () => new HingeAnalyzer()),
  ex('rdl', 'Romanian Deadlifts', 'rdl', SIDE, 'Hinge to the knees, weight close', 'Hamstrings, Glutes, Erectors',
    [PHONE.standing, 'Stand side-on holding the dumbbells at your thighs.'],
    ['Counts hinging until the dumbbells pass your knees, then standing tall.', 'Squatting it down doesn’t count.', 'Calls out bent knees and the weight drifting off your legs.'],
    () => new HingeAnalyzer()),
  ex('bb-hip-thrust', 'Barbell Hip Thrusts', 'thrust', SIDE, 'Flat at the top, no arch', 'Glutes, Hamstrings',
    [PHONE.bench, 'Upper back on the bench side-on, feet flat.', 'Lower your hips to start.'],
    ['Counts driving up until you’re flat from shoulders to knees.', 'Half reps at the bottom don’t count.', 'Calls out arching, foot position and skipping the squeeze.'],
    () => new HipThrustAnalyzer()),
  ex('b-stance-thrust', 'B-Stance Hip Thrusts', 'thrust', SIDE, 'Flat at the top, no arch', 'Glutes, Hamstrings',
    [PHONE.bench, 'Upper back on the bench side-on, working leg nearest the camera.', 'Kickstand foot a half-step forward, on its heel.'],
    ['Counts driving up until you’re flat from shoulders to knees.', 'Calls out arching, foot position and skipping the squeeze.'],
    () => new HipThrustAnalyzer({}, { ready: 'Ready — drive through the working heel' })),
  ex('leg-curl', 'Prone Dumbbell Leg Curl', 'leg-curl', SIDE, 'Shins upright, hips down', 'Hamstrings, Gastrocnemius',
    [PHONE.bench, 'Lie face down side-on, knees at the bench end.'],
    ['Counts curls until your shins are upright and back down.', 'Lifting your hips to swing it doesn’t count.', 'Calls out dropping the dumbbell.'],
    () => new LegCurlAnalyzer()),
  ex('calf-raise', 'Standing Calf Raises', 'calf', SIDE, 'Full range, pause, straight legs', 'Gastrocnemius, Soleus',
    ['Phone at knee height, about 2 m away, feet in view.', 'Stand side-on on the step, heels hanging.'],
    ['Counts rising high onto your toes from the bottom stretch, with the body actually rising.', 'Bent knees and bouncy half reps don’t count.', 'Calls out lowering too fast and skipping the pause.'],
    () => new CalfRaiseAnalyzer()),
  // ---------------- core
  ex('dead-bug', 'Dead Bugs', 'dead-bug', SIDE, 'Opposite arm and leg, slow', 'Rectus Abdominis, TVA',
    [PHONE.floor, 'Lie on your back side-on (angled toward your feet is even better).', 'Arms up, knees over hips at 90°.'],
    ['Counts one arm reaching back while the opposite leg goes long (per side).', 'Calls out rushing and moving the same-side arm and leg.'],
    () => new DeadBugAnalyzer()),
  ex('db-crunch', 'Dumbbell Crunch', 'crunch', SIDE, 'Shoulder blades up, arms fixed', 'Upper Abs, Rectus Abdominis, Obliques',
    [PHONE.bench, 'Lie along the bench side-on, head just past the end.', 'Dumbbell at arm’s length past your head.'],
    ['Counts curling until your shoulder blades clear the bench.', 'Swinging the dumbbell forward doesn’t count.', 'Calls out sitting all the way up.'],
    () => new CrunchAnalyzer()),
  ex('hanging-leg-raise', 'Weighted Hanging Leg Raises', 'leg-raise', SIDE, 'Past level, straight legs, no swing', 'Lower Abs, Rectus Abdominis, Hip Flexors, Obliques',
    [PHONE.bar, 'Hang side-on to the camera.'],
    ['Counts raising straight legs past level and lowering all the way.', 'Swinging and bent-knee raises don’t count.', 'Calls out skipping the pause at the bottom.'],
    () => new HangingLegRaiseAnalyzer()),
  ex('reverse-crunch', 'Weighted Reverse Crunches', 'rev-crunch', SIDE, 'Hips off the bench, no swing', 'Lower Abs, Rectus Abdominis, Hip Flexors, Obliques',
    [PHONE.bench, 'Lie on the bench side-on, knees at 90°.'],
    ['Counts curling your hips up off the bench.', 'Swinging the legs without lifting the hips doesn’t count.', 'Calls out dropping down fast.'],
    () => new ReverseCrunchAnalyzer()),
  ex('side-plank-reach', 'Weighted Side Plank w/ Reach-Through', 'side-plank', FRONT, 'Thread through, hips high', 'Obliques, TVA, Core',
    [PHONE.floor + ' Face it with your chest.', 'Side plank on your elbow or hand, feet stacked.', 'Reach the dumbbell to the ceiling to start.'],
    ['Counts threading the weight under your body and back up (per side).', 'Calls out sagging hips and piking.'],
    () => new SidePlankReachAnalyzer()),
];

// ---------------- skill ladders: one exercise per step
const rollout = (id, name, stance, reach, extra = {}) =>
  ex(id, name, stance === 'stand' ? 'rollout-stand' : 'rollout', SIDE, reach === 'full' ? 'Full extension, tucked, straight arms' : 'Out to the wall, tucked, straight arms', 'Rectus Abdominis, Obliques, TVA, Lats, Serratus Anterior',
    [PHONE.floor, stance === 'stand' ? 'Stand side-on, legs nearly straight, wheel on the floor.' : 'Kneel side-on on a pad, wheel under your shoulders.', reach === 'wall' ? 'Face a wall; roll until the wheel taps it.' : 'Tuck your tailbone before you roll.'],
    [extra.negative ? 'Counts a slow roll-out (2.5 s or more) from standing; drop to your knees to come back.' : 'Counts rolling out with the arms overhead and hips open, then back in.', 'A sagging lower back or bent arms don’t count.', 'Calls out pushing the hips back first on the way in.'],
    () => new RolloutAnalyzer({ stance, reach, ...(extra.negative ? { negativeMs: 2500 } : {}) }, extra.negative ? { toStart: 'Stand with the wheel on the floor to start', reached: 'Out — drop to your knees and roll back', ready: 'Ready — roll out as slowly as you can' } : null));

const handstand = (id, name, variant, extra = {}) =>
  ex(id, name, variant === 'wall' ? 'handstand-wall' : variant === 'oneArm' ? 'handstand-one' : 'handstand', SIDE, extra.blurb ?? 'Hold time, straight line', 'Front Delts, Side Delts, Traps, Triceps, Core',
    [PHONE.floor, extra.setup ?? 'Set up side-on to the camera.', 'The timer runs while you’re upside down.'],
    [extra.check ?? 'Times the hold only while you’re upside down.', 'Calls out bent elbows, closed shoulders, a banana back and piked hips.'],
    () => new HandstandHold({ variant, ...(extra.opts || {}) }, extra.text || null));

const planche = (id, name, step, blurb) =>
  ex(id, name, step === 'frog' || step === 'saFrog' ? 'frog' : step === 'full' || step === 'straddle' || step === 'halfLay' ? 'planche-full' : 'planche', SIDE, blurb, 'Front Delts, Serratus Anterior, Triceps, Forearms, Core',
    [PHONE.floor, 'Set up side-on, hands shoulder-width, fingers spread.', 'The timer starts when your feet float.'],
    ['Times the hold only with your feet off the floor.', step === 'frog' ? 'Keep your knees on your elbows.' : 'Calls out bent arms, low hips and the step’s own shape.'],
    () => new PlancheHold({ step }));

const lever = (id, name, step, blurb) =>
  ex(id, name, step === 'full' || step === 'straddle' || step === 'halfLay' ? 'lever-full' : 'lever', SIDE, blurb, 'Lats, Rear Delts, Mid Traps, Rhomboids, Core, Forearms',
    [PHONE.bar, 'Hang side-on to the camera.', 'The timer starts when your back is level.'],
    ['Times the hold only with your body level under the bar.', 'Calls out bent arms, low hips and the step’s own shape.'],
    () => new LeverHold({ step }));

const hollow = (id, name, step, blurb) =>
  ex(id, name, 'hollow', SIDE, blurb, 'Rectus Abdominis, TVA, Hip Flexors',
    [PHONE.floor, 'Lie on your back side-on.', 'The timer starts when your shoulder blades and legs are up.'],
    ['Times the hold only with your shoulders and legs off the floor.', 'Calls out legs too low, shoulders down and crunching up.'],
    () => new HollowHold({ step, switchLegs: step === 'oneLeg' }));

const archHold = (id, name, step, blurb) =>
  ex(id, name, 'arch', SIDE, blurb, 'Erectors, Glutes, Rear Delts, Traps',
    [PHONE.floor, 'Lie face down side-on.', 'The timer starts when your chest and legs are up.'],
    ['Times the hold only with your chest and legs off the floor.', 'Calls out bent knees and cranking your neck back.'],
    () => new ArchHold({ step }));

const pushVariant = (id, name, fig, view, variant, blurb, setup, checks, extra = {}) =>
  ex(id, name, fig, view, blurb, extra.muscles ?? 'Chest, Triceps, Front Delts, Core', setup, checks,
    (s) => new PushVariantAnalyzer({ depthTarget: s.depthTarget, variant, ...(extra.opts || {}) }), { options: pushOpts });

const hspu = (id, name, opts, blurb, extra = {}) =>
  ex(id, name, 'hspu', SIDE, blurb, 'Front Delts, Side Delts, Triceps, Traps',
    [PHONE.floor, 'Set up side-on to the camera.', extra.setup ?? 'Kick up to the wall with straight arms.'],
    [extra.check ?? 'Counts lowering until your head touches the floor and pressing back to straight arms.', 'Kicking the legs to get up doesn’t count.', 'Calls out a banana back.'],
    () => new HSPUAnalyzer(opts, extra.text || null));

export const LADDER_EXERCISES = [
  // Handstand
  handstand('wall-handstand', 'Wall Handstand Hold', 'wall', { setup: 'Chest to the wall, side-on to the camera.' }),
  handstand('toe-pulls', 'Wall Toe Pulls', 'wall', { setup: 'Chest to the wall, side-on. Ease your feet off it.', check: 'Times your whole hold upside down (it can’t see the wall).' }),
  handstand('kick-ups', 'Freestanding Kick-Ups', 'free', { blurb: 'Every attempt, timed', check: 'Each kick-up is an attempt, scored by the time you catch.', opts: { attempts: true, minSetMs: 300 }, text: { start: '' } }),
  handstand('handstand', 'Freestanding Handstand', 'free', { setup: 'Kick up side-on to the camera.' }),
  ex('straddle-press', 'Straddle Press to Handstand', 'press-hs', SIDE, 'Lean until the feet float', 'Front Delts, Traps, Triceps, Hip Flexors, Core',
    [PHONE.floor, 'Stand in a wide straddle side-on, hands on the floor.'],
    ['Counts pressing from the floor up to a handstand and back down.', 'Hopping off the floor or bending the arms doesn’t count.'],
    () => new StraddlePressAnalyzer()),
  handstand('one-arm-handstand', 'One-Arm Handstand', 'oneArm', { setup: 'Side-on, then shift onto one hand.', check: 'Times the hold only with one hand off the floor.' }),
  // Planche
  planche('frog-stand', 'Frog Stand', 'frog', 'Feet up, balance on your hands'),
  planche('sa-frog-stand', 'Straight-Arm Frog Stand', 'saFrog', 'Feet up, arms locked'),
  planche('tuck-planche', 'Tuck Planche', 'tuck', 'Arms locked, hips level'),
  planche('adv-tuck-planche', 'Advanced Tuck Planche', 'advTuck', 'Flat back, thighs square'),
  planche('straddle-planche', 'Straddle Planche', 'straddle', 'Straight legs at hip height'),
  planche('halflay-planche', 'Half-Lay Planche', 'halfLay', 'Hips open, knees bent'),
  planche('full-planche', 'Full Planche', 'full', 'One straight, level line'),
  // Front lever
  ex('scap-pulls', 'Scapular Pulls', 'pull-up', EITHER, 'Shoulders down, arms locked', 'Lats, Mid Traps, Rhomboids, Forearms',
    [PHONE.bar, 'Hang with straight arms (side-on is best).'],
    ['Counts pulling your shoulders down so your body rises, elbows locked.', 'Bending the elbows or swinging doesn’t count.', 'Calls out skipping the pause at the top.'],
    () => new ScapPullAnalyzer()),
  ex('arch-hangs', 'Arch Hangs', 'arch-hang', SIDE, 'Chest up, arms straight', 'Lats, Mid Traps, Rhomboids, Rear Delts, Forearms',
    [PHONE.bar, 'Hang side-on to the camera.'],
    ['Counts lifting your chest toward the bar into an arch.', 'Rowing up with bent arms or kicking the legs doesn’t count.', 'Calls out skipping the hold at the top.'],
    () => new ArchHangAnalyzer()),
  lever('tuck-lever', 'Tuck Front Lever', 'tuck', 'Back level, knees tucked'),
  lever('adv-tuck-lever', 'Advanced Tuck Front Lever', 'advTuck', 'Flat back, thighs square'),
  lever('straddle-lever', 'Straddle Front Lever', 'straddle', 'Legs straight and in line'),
  lever('halflay-lever', 'Half-Lay Front Lever', 'halfLay', 'Hips open, knees bent'),
  lever('full-lever', 'Full Front Lever', 'full', 'One straight, level line'),
  ex('scap-pushup', 'Scapular Push-Ups', 'pushup', SIDE, 'Shoulder blades only, arms locked', 'Serratus Anterior, Traps, Core',
    [PHONE.floor, 'Push-up plank side-on, arms locked.'],
    ['Counts your chest sinking between your shoulder blades and pushing back up.', 'Bending the elbows doesn’t count.', 'Calls out sagging hips.'],
    () => new ScapPushupAnalyzer()),
  // Push-up
  pushVariant('diamond-pushup', 'Diamond Push-Ups', 'pushup', EITHER, 'diamond', 'Depth, hands together',
    [PHONE.head + ' It checks your hands from there.', 'Or film side-on to check your body line instead.'],
    ['Counts reps to depth and back to straight arms.', 'Facing the camera: hands apart doesn’t count; calls out flared elbows.', 'Side-on: calls out sagging or piked hips.'],
    { opts: { frontBottom: 0.62 }, muscles: 'Triceps, Chest, Front Delts, Serratus Anterior, Core' }),
  pushVariant('decline-pushup', 'Decline Push-Ups', 'decline', SIDE, 'standard', 'Depth, feet up, body line',
    [PHONE.floor, 'Feet up on the bench, side-on to the camera.'],
    ['Counts reps to depth and back to straight arms, with your feet up.', 'Calls out sagging or piked hips.'],
    { opts: { feetUp: true }, muscles: 'Upper Chest, Front Delts, Triceps, Serratus Anterior, Core' }),
  pushVariant('archer-pushup', 'Archer Push-Ups', 'archer', FRONT, 'archer', 'One arm bends, one stays long',
    [PHONE.head, 'Hands about twice shoulder-width.'],
    ['Counts lowering toward one hand while the other arm stays straight (per side).', 'Bending both arms doesn’t count.', 'Calls out twisting.'],
    { opts: { frontBottom: 0.7 } }),
  pushVariant('incline-oap', 'Incline One-Arm Push-Ups', 'one-arm', FRONT, 'oneArm', 'One hand, square shoulders',
    ['Phone at bench height in front of the bench, about 1.5 m away, facing you.', 'One hand on the bench, feet wide, free hand behind your back.'],
    ['Counts reps to depth on one hand (per side).', 'Putting the free hand down doesn’t count.', 'Calls out twisting.'],
    { opts: { frontBottom: 0.6 }, muscles: 'Chest, Triceps, Front Delts, Obliques, Core' }),
  pushVariant('oap', 'One-Arm Push-Ups', 'one-arm', FRONT, 'oneArm', 'One hand, square shoulders',
    [PHONE.head, 'Feet wide, free hand behind your back.'],
    ['Counts reps to depth on one hand (per side).', 'Putting the free hand down doesn’t count.', 'Calls out twisting.'],
    { opts: { frontBottom: 0.62 }, muscles: 'Chest, Triceps, Front Delts, Obliques, Core' }),
  pushVariant('oap-feet', 'One-Arm Push-Ups, Feet Together', 'one-arm', FRONT, 'oneArm', 'One hand, feet together',
    [PHONE.head, 'Feet together, free hand behind your back.'],
    ['Counts reps to depth on one hand (per side), feet together.', 'Putting the free hand down doesn’t count.', 'Calls out twisting and feet creeping apart.'],
    { opts: { frontBottom: 0.62, feetTogether: true }, muscles: 'Chest, Triceps, Front Delts, Obliques, Core' }),
  // Handstand push-up
  ex('pike-pushup', 'Pike Push-Ups', 'pike', SIDE, 'Head to the floor, hips high', 'Front Delts, Side Delts, Triceps, Upper Chest',
    [PHONE.floor, 'Hands down, hips high in an upside-down V, side-on.'],
    ['Counts lowering your head toward the floor and pressing back to straight arms.', 'Bending the elbows without the head going down doesn’t count.', 'Calls out hips dropping and the head going between the hands.'],
    () => new PikePushupAnalyzer()),
  ex('elevated-pike', 'Elevated Pike Push-Ups', 'pike-elevated', SIDE, 'Hips stacked, head to the floor', 'Front Delts, Side Delts, Triceps, Upper Chest',
    [PHONE.floor, 'Feet on the bench, hips over your hands, side-on.'],
    ['Counts lowering your head toward the floor and pressing back to straight arms.', 'Calls out hips drifting back and the head going between the hands.'],
    () => new PikePushupAnalyzer({ elevated: true })),
  hspu('hspu-negative', 'Wall Handstand Push-Up Negatives', { negativeMs: 2500 }, 'Slow lowering to the head', {
    check: 'Counts lowering from straight arms to your head on the floor over 2.5 s or more.',
    text: { ready: 'Ready — lower slowly, 3 to 5 seconds', reached: 'Head down — come off the wall', toStart: 'Kick up to the wall with straight arms' },
  }),
  hspu('wall-hspu', 'Wall Handstand Push-Ups', {}, 'Head to the floor, lockout'),
  hspu('deficit-hspu', 'Deficit Wall Handstand Push-Ups', { bottomH: 0.33 }, 'Head below the hands, lockout', { setup: 'Hands on stable blocks at the wall.', check: 'Counts lowering until your head sinks below your hands and pressing back to straight arms.' }),
  hspu('fs-hspu', 'Freestanding Handstand Push-Ups', {}, 'Head to the floor, lockout', { setup: 'Kick up to a steady freestanding handstand.' }),
  // Ab wheel
  rollout('rollout-wall-kneel', 'Kneeling Rollouts to a Wall', 'kneel', 'wall'),
  rollout('rollout', 'Ab Wheel Rollouts', 'kneel', 'full'),
  rollout('rollout-wall-stand', 'Standing Rollouts to a Wall', 'stand', 'wall'),
  rollout('rollout-negative', 'Standing Rollout Negatives', 'stand', 'full', { negative: true }),
  rollout('rollout-stand', 'Standing Ab Wheel Rollouts', 'stand', 'full'),
  rollout('rollout-weighted', 'Weighted Standing Rollouts', 'stand', 'full'),
  // Hollow body
  hollow('tuck-hollow', 'Tuck Hollow Hold', 'tuck', 'Knees in, shoulder blades up'),
  hollow('one-leg-hollow', 'One-Leg Hollow Hold', 'oneLeg', 'One leg long, switch halfway'),
  hollow('hollow-hold', 'Hollow Body Hold', 'full', 'Legs long and low, back flat'),
  hollow('overhead-hollow', 'Overhead Hollow Hold', 'overhead', 'Arms overhead, back flat'),
  ex('hollow-rocks', 'Hollow Body Rocks', 'hollow', SIDE, 'Rock, don’t bend', 'Rectus Abdominis, TVA, Hip Flexors',
    [PHONE.floor, 'Lie on your back side-on in the hollow hold, arms overhead.'],
    ['Counts each rock head-to-toe and back.', 'Bending at the hips to keep it going doesn’t count.', 'Calls out arms dropping.'],
    () => new RockAnalyzer({ shape: 'hollow' })),
  // Arch body
  archHold('arch-hold', 'Arch Hold', 'hold', 'Chest and legs up, neck long'),
  archHold('overhead-arch', 'Overhead Arch Hold', 'overhead', 'Arms overhead, chest and legs up'),
  ex('arch-rocks', 'Arch Body Rocks', 'arch', SIDE, 'Rock, don’t bend', 'Erectors, Glutes, Rear Delts, Traps',
    [PHONE.floor, 'Lie face down side-on in the arch hold, arms overhead.'],
    ['Counts each rock chest-to-thighs and back.', 'Bending at the hips or knees to keep it going doesn’t count.'],
    () => new RockAnalyzer({ shape: 'arch' })),
  ex('reverse-hyper', 'Reverse Hyperextensions', 'rev-hyper', SIDE, 'Legs to level, straight', 'Glutes, Hamstrings, Erectors',
    [PHONE.bench, 'Lie face down side-on, hips at the end of the bench.'],
    ['Counts lifting straight legs up to body level.', 'Bent knees don’t count.', 'Calls out lifting past level and swinging.'],
    () => new ReverseHyperAnalyzer()),
  ex('weighted-reverse-hyper', 'Weighted Reverse Hyperextensions', 'rev-hyper', SIDE, 'Legs to level, controlled', 'Glutes, Hamstrings, Erectors',
    [PHONE.bench, 'Lie face down side-on, hips at the end, dumbbell between your feet.'],
    ['Counts lifting straight legs up to body level.', 'Bent knees don’t count.', 'Calls out lifting past level, swinging and dropping it.'],
    () => new ReverseHyperAnalyzer({ minEccMs: 800 })),
  // Warm-up
  ex('wrist-rocks', 'Wrist Prep Rocks', 'rocks', SIDE, 'Slow rocks, straight elbows', 'Forearms',
    [PHONE.floor, 'On all fours side-on, hands under your shoulders.'],
    ['Counts slow rocks forward over your hands and back (side-to-side rocks can’t be seen side-on).', 'Calls out bent elbows and rushing.'],
    () => new WristRockAnalyzer()),
];

export const EXERCISES = [...GENERAL, ...PROGRAM_EXERCISES, ...LADDER_EXERCISES];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
export const exerciseById = (id) => BY_ID.get(id) || null;
