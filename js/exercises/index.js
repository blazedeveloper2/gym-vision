import { PushupAnalyzer } from './pushup.js';
import { SquatAnalyzer } from './squat.js';
import { LungeAnalyzer } from './lunge.js';
import { CurlAnalyzer } from './curl.js';
import { PressAnalyzer } from './press.js';
import { LateralRaiseAnalyzer } from './lateral.js';
import { JacksAnalyzer } from './jacks.js';
import { PlankAnalyzer } from './plank.js';

/**
 * Exercise catalog: what the home screen lists and how each one is set up.
 * `create(settings)` builds the analyzer; `options(settings)` re-applies
 * settings that can change mid-session.
 */
export const EXERCISES = [
  {
    id: 'pushup',
    name: 'Push-ups',
    blurb: 'Depth, hip sag and lockout',
    view: 'Side view',
    setup: ['Put your phone on the floor in landscape, about 2 m away.', 'Set up side-on so your whole body is in frame.', 'Get into a plank. Reps count automatically.'],
    create: (s) => new PushupAnalyzer({ depthTarget: s.depthTarget }),
    options: (s) => ({ depthTarget: s.depthTarget }),
  },
  {
    id: 'squat',
    name: 'Squats',
    blurb: 'Depth, forward lean and knees',
    view: 'Side or front',
    setup: ['Prop your phone at about hip height, 2–3 m away.', 'Side-on checks depth and lean. Facing the camera checks your knees.', 'Stand tall. Reps count automatically.'],
    create: (s) => new SquatAnalyzer({ depthTarget: s.squatDepth }),
    options: (s) => ({ depthTarget: s.squatDepth }),
  },
  {
    id: 'lunge',
    name: 'Lunges',
    blurb: 'Knee depth and upright torso',
    view: 'Side view',
    setup: ['Prop your phone at hip height, 2–3 m away.', 'Stand side-on with room to step forward or back.', 'Lower until your front knee is at about 90°.'],
    create: () => new LungeAnalyzer(),
  },
  {
    id: 'curl',
    name: 'Bicep curls',
    blurb: 'Full range and elbow swing',
    view: 'Side or front',
    setup: ['Prop your phone at chest height, about 2 m away.', 'Side-on shows elbow swing best; facing works too.', 'Start with your arms straight down.'],
    create: () => new CurlAnalyzer(),
  },
  {
    id: 'press',
    name: 'Shoulder press',
    blurb: 'Lockout and even arms',
    view: 'Front view',
    setup: ['Prop your phone at chest height, about 2 m away, facing you.', 'Start with the weights at your shoulders.', 'Press until your arms are straight overhead.'],
    create: () => new PressAnalyzer(),
  },
  {
    id: 'lateral',
    name: 'Lateral raises',
    blurb: 'Shoulder height and even arms',
    view: 'Front view',
    setup: ['Prop your phone at chest height, about 2 m away, facing you.', 'Arms at your sides with a slight bend in the elbows.', 'Raise to shoulder height, then lower slowly.'],
    create: () => new LateralRaiseAnalyzer(),
  },
  {
    id: 'jacks',
    name: 'Jumping jacks',
    blurb: 'Full spread every rep',
    view: 'Front view',
    setup: ['Prop your phone at hip height, 2–3 m away, facing you.', 'Check your hands stay in frame when overhead.', 'Start jumping. Reps count automatically.'],
    create: () => new JacksAnalyzer(),
  },
  {
    id: 'plank',
    name: 'Plank',
    blurb: 'Hold timer and hip line',
    view: 'Side view',
    setup: ['Put your phone on the floor in landscape, about 2 m away.', 'Set up side-on so your whole body is in frame.', 'Hold a plank. The timer runs while you hold it.'],
    create: () => new PlankAnalyzer(),
  },
];

export const exerciseById = (id) => EXERCISES.find((e) => e.id === id) || null;
