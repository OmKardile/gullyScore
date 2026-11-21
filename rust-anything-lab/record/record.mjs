#!/usr/bin/env bun
/**
 * rust-anything-lab — RECORD step (mini re-implementation of `rust-anything record`)
 *
 * Runs the ORIGINAL TypeScript units (GullyScoreRN's pure engines, read-only)
 * on curated edge cases + deterministic fuzz, and writes:
 *   ../cases.jsonl         one recorded case per line: {id, fn, args, expected}
 *   ../recorded-from.json  fingerprint of the source files (stale-recording guard)
 *
 * Lessons applied from upstream rust-anything (upstream/DECISIONS.md):
 *   L5 — deterministic inputs from a fixed seed: re-running records the same cases
 *   X2 — thrown errors cross as {"$threw": "TypeError"} markers, not raw text
 *   M4 — nothing is written into the original repository; the app is only read
 *        (playerStatsEngine is recorded from ../work/GullyScoreRN — a copy whose
 *        ONLY difference is the stubbed, never-called storage import; the copy
 *        is refreshed from the original every run, so the engines are identical)
 *
 * Usage (from the lab root):  bun record/record.mjs
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as scoringEngine from "../../GullyScoreRN/src/engine/scoringEngine.ts";
import * as predictionEngine from "../../GullyScoreRN/src/engine/predictionEngine.ts";

// ---------------------------------------------------------------- PRNG (L5)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xc0ffee);
const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const mk = (id) => `${id}${ri(100, 999)}`;

// ------------------------------------------------------- domain value pools
const WICKET_TYPES = [
  "bowled", "caught", "caught_bowled", "caught_behind", "lbw", "run_out",
  "stumped", "hit_wicket", "hit_ball_twice", "obstructing_field",
  "handled_ball", "timed_out", "retired_out", "retired_hurt",
];
const EXTRAS = ["none", "none", "none", "none", "none", "none", "none",
  "wide", "wide", "no_ball", "no_ball", "bye", "leg_bye", "penalty"];
const ROLES = ["batsman", "bowler", "all_rounder", "wicket_keeper"];
const HANDS = ["right", "left"];
const STYLES = ["rf", "rm", "spin_off", "spin_leg", "lf", "lm", "sla", "other"];

function makeRules(over = {}) {
  return {
    overs: over.overs ?? ri(2, 20),
    playersPerSide: over.playersPerSide ?? ri(6, 11),
    ballType: pick(["tennis", "leather", "box"]),
    wideRunValue: pick([0, 1, 1, 2]),
    noBallRunValue: pick([1, 1, 2]),
    freeHitOnNoBall: chance(0.5),
    lastManBatting: over.lastManBatting ?? chance(0.15),
    maxOversPerBowler: ri(1, 4),
    noConsecutiveOvers: chance(0.5),
    superOverOnTie: chance(0.1),
    trackShotDirection: chance(0.5),
  };
}

/** BallEvent projection: only the fields the engines read (rust/PORT_MAP.md). */
function ball(o = {}) {
  const extraType = o.extraType ?? "none";
  return {
    strikerId: o.strikerId ?? "p1",
    nonStrikerId: o.nonStrikerId ?? "p2",
    bowlerId: o.bowlerId ?? "b1",
    runsBat: o.runsBat ?? 0,
    extraType,
    extraRuns: o.extraRuns ?? 0,
    isLegal: o.isLegal ?? (extraType !== "wide" && extraType !== "no_ball"),
    wicket: "wicket" in o ? o.wicket : undefined,
  };
}

function wicket(o = {}) {
  return {
    type: o.type ?? "bowled",
    dismissedPlayerId: o.dismissedPlayerId ?? "p1",
    dismissedEnd: o.dismissedEnd ?? "striker",
    fielderIds: o.fielderIds ?? [],
    runsCompleted: o.runsCompleted ?? 0,
  };
}

function makePlayer(id, name) {
  return {
    id,
    name: name ?? pick(["Ravi", "Arun", "Zoë", "李伟", "Sameer", "Jai", ""]),
    nickname: chance(0.4) ? pick(["Rav", "Z", "Jo"]) : undefined,
    role: pick(ROLES),
    battingHand: pick(HANDS),
    bowlingStyle: pick(STYLES),
    photoUri: undefined,
    isArchived: chance(0.1),
    createdAt: 1700000000000,
    updatedAt: chance(0.5) ? 1700000001000 : undefined,
  };
}

function playersMapFor(ids) {
  const map = {};
  for (const id of ids) map[id] = makePlayer(id);
  return map;
}

function makeScorecard(o = {}) {
  return {
    inningsIndex: o.inningsIndex ?? 0,
    battingTeamId: o.battingTeamId ?? "tA",
    bowlingTeamId: o.bowlingTeamId ?? "tB",
    totalRuns: o.totalRuns ?? 0,
    totalWickets: o.totalWickets ?? 0,
    legalBallsCount: o.legalBallsCount ?? 0,
    oversFormatted: o.oversFormatted ?? "0.0",
    runRate: o.runRate ?? 0,
    extras: o.extras ?? { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 },
    batters: o.batters ?? [],
    bowlers: o.bowlers ?? [],
    fallOfWickets: o.fallOfWickets ?? [],
    partnerships: o.partnerships ?? [],
    overSummaries: o.overSummaries ?? [],
    didNotBatPlayerIds: o.didNotBatPlayerIds ?? [],
    currentStrikerId: o.currentStrikerId ?? "",
    currentNonStrikerId: o.currentNonStrikerId ?? "",
    currentBowlerId: o.currentBowlerId ?? "",
    isCompleted: o.isCompleted ?? false,
    ...(o.completionReason !== undefined ? { completionReason: o.completionReason } : {}),
    ...(o.targetRuns !== undefined ? { targetRuns: o.targetRuns } : {}),
    ...(o.isSuperOver !== undefined ? { isSuperOver: o.isSuperOver } : {}),
  };
}

// ------------------------------------------------------------- case builders
const cases = [];
let caseId = 0;
function add(fn, args) {
  cases.push({ id: `c${String(++caseId).padStart(4, "0")}`, fn, args });
}

// -- 1. formatOvers / parseOversToDecimal / ballsToOversFraction over the domain
for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 17, 18, 23, 24, 29, 30, 35, 36, 59, 60, 71, 119, 120]) {
  add("formatOvers", { legalBalls: n });
  add("parseOversToDecimal", { legalBalls: n });
  add("ballsToOversFraction", { legalBalls: n });
}

// -- 2. isDismissalCreditedToBowler: every wicket type (the whole enum)
for (const t of WICKET_TYPES) {
  add("isDismissalCreditedToBowler", { type: t });
}

// -- 3. deriveLiveCrease: curated edge cases
const R = (lastManBatting) => makeRules({ lastManBatting });
add("deriveLiveCrease", { ballEvents: [], rules: R(false), battingSquadIds: ["p1", "p2", "p3"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: null, rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball()], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
// odd / even strike rotation
add("deriveLiveCrease", { ballEvents: [ball({ runsBat: 1 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball({ runsBat: 2 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball({ runsBat: 3 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
// bye / leg_bye extras count toward the parity swap; wide extras do NOT
add("deriveLiveCrease", { ballEvents: [ball({ extraType: "bye", extraRuns: 1 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball({ extraType: "bye", extraRuns: 2 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball({ extraType: "leg_bye", extraRuns: 3 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball({ extraType: "wide", extraRuns: 1 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball({ extraType: "no_ball", extraRuns: 1, isLegal: false })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
// end-of-over swap, with and without last-man-batting
const sixDots = Array.from({ length: 6 }, () => ball());
add("deriveLiveCrease", { ballEvents: sixDots, rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: sixDots, rules: R(true), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
// 5 legal + wides: over does NOT complete (wides are not legal)
add("deriveLiveCrease", {
  ballEvents: [...Array.from({ length: 5 }, () => ball()), ball({ extraType: "wide", isLegal: false }), ball()],
  rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"],
});
// two completed overs
add("deriveLiveCrease", { ballEvents: Array.from({ length: 12 }, () => ball()), rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1", "b2"] });
// wicket ends the log -> pendingBatter true; retired_hurt -> false
add("deriveLiveCrease", {
  ballEvents: [ball(), ball({ wicket: wicket({ type: "bowled", dismissedPlayerId: "p1" }) })],
  rules: R(false), battingSquadIds: ["p1", "p2", "p3"], bowlingSquadIds: ["b1"],
});
add("deriveLiveCrease", {
  ballEvents: [ball(), ball({ wicket: wicket({ type: "retired_hurt", dismissedPlayerId: "p1" }) })],
  rules: R(false), battingSquadIds: ["p1", "p2", "p3"], bowlingSquadIds: ["b1"],
});
// wicket with odd runsCompleted: swap AND pending
add("deriveLiveCrease", {
  ballEvents: [ball({ wicket: wicket({ type: "run_out", dismissedPlayerId: "p2", runsCompleted: 1 }) })],
  rules: R(false), battingSquadIds: ["p1", "p2", "p3"], bowlingSquadIds: ["b1"],
});
// next ball after a wicket reveals the incoming batter and clears pending
add("deriveLiveCrease", {
  ballEvents: [
    ball({ wicket: wicket({ type: "caught", dismissedPlayerId: "p1", fielderIds: ["f1"] }) }),
    ball({ strikerId: "p3", nonStrikerId: "p2" }),
  ],
  rules: R(false), battingSquadIds: ["p1", "p2", "p3"], bowlingSquadIds: ["b1"],
});
// empty ids: no swap is possible (guard `striker && nonStriker`)
add("deriveLiveCrease", { ballEvents: [ball({ strikerId: "", nonStrikerId: "", runsBat: 1 })], rules: R(false), battingSquadIds: [], bowlingSquadIds: [] });
add("deriveLiveCrease", { ballEvents: [ball({ strikerId: "", nonStrikerId: "", runsBat: 1 })], rules: R(false), battingSquadIds: ["p1", "p2"], bowlingSquadIds: ["b1"] });
add("deriveLiveCrease", { ballEvents: [ball({ bowlerId: "" })], rules: R(false), battingSquadIds: ["p1"], bowlingSquadIds: [] });
// log ends exactly at the over break ON a wicket ball (both effects)
add("deriveLiveCrease", {
  ballEvents: [...Array.from({ length: 5 }, () => ball()), ball({ wicket: wicket({ type: "stumped", dismissedPlayerId: "p1" }) })],
  rules: R(false), battingSquadIds: ["p1", "p2", "p3"], bowlingSquadIds: ["b1"],
});

// -- 4. deterministic fuzz innings (semi-realistic event logs)
function fuzzInnings(o = {}) {
  const rules = o.rules ?? makeRules();
  const batters = o.batters ?? ["p1", "p2", "p3", "p4", "p5", "p6", "p7"].slice(0, ri(4, 7));
  const bowlers = o.bowlers ?? ["b1", "b2", "b3"].slice(0, ri(1, 3));
  let striker = batters[0] ?? "";
  let nonStriker = batters[1] ?? "";
  let bowler = bowlers[0] ?? "";
  const events = [];
  const n = o.n ?? ri(0, 24);
  for (let i = 0; i < n; i++) {
    if (chance(0.05)) striker = chance(0.4) ? "" : pick(batters);
    if (chance(0.05)) nonStriker = chance(0.4) ? "" : pick(batters);
    if (chance(0.1)) bowler = chance(0.3) ? "" : pick(bowlers);
    const extraType = pick(EXTRAS);
    const isLegal = extraType === "wide" || extraType === "no_ball" ? chance(0.03) : chance(0.97);
    const runsBat = pick([0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 4, 6, 5]);
    const extraRuns = extraType === "none" ? 0 : ri(0, 4);
    let w = undefined;
    if (chance(0.12)) {
      w = wicket({
        type: pick(WICKET_TYPES),
        dismissedPlayerId: chance(0.7) ? striker : nonStriker,
        dismissedEnd: pick(["striker", "non_striker"]),
        fielderIds: chance(0.3) ? [] : chance(0.5) ? ["f1"] : ["f1", "f2"],
        runsCompleted: ri(0, 3),
      });
      if (w.type !== "retired_hurt" && chance(0.8)) {
        const nb = pick(batters);
        if (w.dismissedPlayerId === striker) striker = nb;
        else nonStriker = nb;
      }
    }
    events.push(ball({ strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler, runsBat, extraType, extraRuns, isLegal, wicket: w }));
    const rc = w ? w.runsCompleted : runsBat;
    const tot = rc + ((extraType === "bye" || extraType === "leg_bye") ? extraRuns : 0);
    if (tot % 2 !== 0 && striker && nonStriker) {
      const t = striker; striker = nonStriker; nonStriker = t;
    }
  }
  return { ballEvents: events, rules, battingSquadIds: batters, bowlingSquadIds: bowlers };
}
const FUZZ_INNINGS = 250;
for (let i = 0; i < FUZZ_INNINGS; i++) {
  add("deriveLiveCrease", fuzzInnings());
}

// -- 5. getDismissalText: every type × fielder/name/bowler variants
{
  const pm = {
    b1: makePlayer("b1", "Bowler One"),
    b2: makePlayer("b2", ""),
    f1: makePlayer("f1", "Fielder One"),
    f2: makePlayer("f2", "Zoë"),
    f3: makePlayer("f3", "李伟"),
  };
  for (const t of WICKET_TYPES) {
    for (const fielderIds of [[], ["f1"], ["f1", "f2"], ["f3"], ["fx"]]) {
      add("getDismissalText", {
        dismissal: wicket({ type: t, dismissedPlayerId: "p1", fielderIds }),
        playersMap: pm,
        bowlerId: "b1",
      });
    }
    add("getDismissalText", { dismissal: wicket({ type: t, fielderIds: ["f1"] }), playersMap: pm, bowlerId: "b2" }); // empty bowler name
    add("getDismissalText", { dismissal: wicket({ type: t, fielderIds: ["f1"] }), playersMap: pm, bowlerId: "bx" }); // unknown bowler
  }
}

// -- 6. replayInnings: curated + fuzz (with playersMap / targets / super overs)
function replayCase(inn, extra = {}) {
  const players = playersMapFor([...inn.battingSquadIds, ...inn.bowlingSquadIds, "f1", "f2"]);
  add("replayInnings", {
    ballEvents: inn.ballEvents,
    rules: inn.rules,
    battingSquadIds: inn.battingSquadIds,
    bowlingSquadIds: inn.bowlingSquadIds,
    playersMap: players,
    ...(extra.targetRuns !== undefined ? { targetRuns: extra.targetRuns } : {}),
    ...(extra.isSuperOver !== undefined ? { isSuperOver: extra.isSuperOver } : {}),
  });
  return inn;
}
{
  const sq = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  replayCase(fuzzInnings({ rules: makeRules({ overs: 5 }), batters: sq, bowlers: ["b1", "b2"], n: 0 }));
  replayCase(fuzzInnings({ rules: makeRules({ overs: 5 }), batters: sq, bowlers: ["b1"], n: 1 }));
  replayCase(fuzzInnings({ rules: makeRules({ overs: 2 }), batters: sq, bowlers: ["b1"], n: 6 }));
  replayCase(fuzzInnings({ rules: makeRules({ overs: 2 }), batters: sq, bowlers: ["b1"], n: 12 }));
  // target reached mid-chase
  const chase = fuzzInnings({ rules: makeRules({ overs: 4 }), batters: sq, bowlers: ["b1"], n: 18 });
  replayCase(chase, { targetRuns: 1 });
  replayCase(chase, { targetRuns: 30 });
  replayCase(chase, { targetRuns: 0 }); // 0 is defined in TS: completed at 0 runs
  replayCase(chase, { isSuperOver: true });
  replayCase(chase, { targetRuns: 25, isSuperOver: true });
  // short squad all-out (the app's own shortside rule: 7-player side in 11-a-side)
  const shortSquad = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
  const allOut = [];
  for (let i = 0; i < shortSquad.length - 1; i++) {
    allOut.push(ball({ strikerId: shortSquad[i], nonStrikerId: shortSquad[i + 1] || "s7", bowlerId: "b1", wicket: wicket({ type: "bowled", dismissedPlayerId: shortSquad[i] }) }));
    if (i < shortSquad.length - 2) allOut.push(ball({ strikerId: shortSquad[i + 1], nonStrikerId: shortSquad[i + 2], bowlerId: "b1", runsBat: 1 }));
  }
  replayCase({ ballEvents: allOut, rules: makeRules({ overs: 10, playersPerSide: 11, lastManBatting: false }), battingSquadIds: shortSquad, bowlingSquadIds: ["b1"] });
  // last-man: the 7th wicket falls but the lone batter continues
  const lastMan = allOut.slice(0, 7);
  replayCase({ ballEvents: [...lastMan, ball({ strikerId: "s7", nonStrikerId: "s1", bowlerId: "b1", runsBat: 4 })], rules: makeRules({ overs: 10, playersPerSide: 11, lastManBatting: true }), battingSquadIds: shortSquad, bowlingSquadIds: ["b1"] });
  // extras quirks
  const q = (evs, o = {}) => replayCase({ ballEvents: evs, rules: o.rules ?? makeRules({ overs: 3 }), battingSquadIds: o.squad ?? ["p1", "p2"], bowlingSquadIds: ["b1"] });
  q([ball({ extraType: "wide", extraRuns: 0 })]);            // wideRunValue fallback
  q([ball({ extraType: "wide", extraRuns: 4 })]);            // explicit extraRuns
  q([ball({ extraType: "no_ball", extraRuns: 0 })]);
  q([ball({ extraType: "no_ball", extraRuns: 3, runsBat: 2 })]); // batter credited on NB
  q([ball({ extraType: "bye", extraRuns: 2, runsBat: 1 })]); // runsBat in total but NOT credited
  q([ball({ extraType: "leg_bye", extraRuns: 1 })]);
  q([ball({ extraType: "penalty", extraRuns: 5 })]);
  q([ball({ runsBat: 5 })]);                                 // out-of-domain runsBat
  q([ball({ bowlerId: "" })]);                               // "" bowler entry
  q([ball({ nonStrikerId: "" })]);                           // nonStriker not registered
  q([ball({ strikerId: "", nonStrikerId: "" })]);
  // wicket on the over-closing ball + retired_hurt mid-innings
  q([...Array.from({ length: 5 }, () => ball()), ball({ wicket: wicket({ type: "lbw", dismissedPlayerId: "p1" }) }), ball({ strikerId: "p3", nonStrikerId: "p2", runsBat: 1 })]);
  q([ball(), ball({ wicket: wicket({ type: "retired_hurt", dismissedPlayerId: "p1" }) }), ball({ strikerId: "p3", nonStrikerId: "p1", runsBat: 2 })]);
  // maidens: a full over of dots
  q(Array.from({ length: 6 }, () => ball()), { rules: makeRules({ overs: 1 }) });
  q([...Array.from({ length: 5 }, () => ball()), ball({ runsBat: 1 })], { rules: makeRules({ overs: 1 }) }); // non-maiden
  // 250 fuzz replays with players, sometimes targets/super overs
  for (let i = 0; i < 250; i++) {
    const inn = fuzzInnings();
    const extra = {};
    if (chance(0.3)) extra.targetRuns = ri(1, 120);
    if (chance(0.05)) extra.isSuperOver = true;
    replayCase(inn, extra);
  }
}

// -- 7. calculateMatchMVPPoints: tier-hitting hand-built scorecards + replayed pairs
{
  const bat = (playerId, runs, ballsFaced, sr, o = {}) => ({
    playerId, runs, ballsFaced, fours: o.fours ?? 0, sixes: o.sixes ?? 0,
    strikeRate: sr, isOut: o.isOut ?? false,
    ...(o.dismissalText !== undefined ? { dismissalText: o.dismissalText } : {}),
    ...(o.dismissedByBowlerId !== undefined ? { dismissedByBowlerId: o.dismissedByBowlerId } : {}),
    ...(o.fielderIds !== undefined ? { fielderIds: o.fielderIds } : {}),
    ...(o.wicketType !== undefined ? { wicketType: o.wicketType } : {}),
    battingOrder: o.battingOrder ?? 1,
  });
  const bowl = (playerId, wickets, o = {}) => ({
    playerId, overs: o.overs ?? 2.0, legalBalls: o.legalBalls ?? 12,
    maidens: o.maidens ?? 0, runsConceded: o.runsConceded ?? 10, wickets,
    economy: o.economy ?? 5.0, wides: 0, noBalls: 0, dots: o.dots ?? 6,
  });
  const sc = (batters, bowlers) => makeScorecard({ batters, bowlers });
  add("calculateMatchMVPPoints", { scorecards: [] });
  add("calculateMatchMVPPoints", { scorecards: [sc([], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 10, 10, 100)], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 30, 25, 120)], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 50, 40, 125)], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 100, 60, 166.7)], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 20, 10, 200)], [])] });   // SR bonus
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 10, 5, 200)], [])] });    // SR high, runs < 15
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 29, 30, 96.7)], [bowl("b1", 2)])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([], [bowl("b1", 3)])] });            // 3W bonus
  add("calculateMatchMVPPoints", { scorecards: [sc([], [bowl("b1", 5)])] });            // 5W bonus
  add("calculateMatchMVPPoints", { scorecards: [sc([], [bowl("b1", 2, { maidens: 2 })])] }); // maiden pts
  add("calculateMatchMVPPoints", { scorecards: [sc([], [bowl("b1", 2, { economy: 5.5, legalBalls: 12 })])] }); // econ bonus
  add("calculateMatchMVPPoints", { scorecards: [sc([], [bowl("b1", 2, { economy: 5.5, legalBalls: 11 })])] }); // < 12 balls
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 20, 20, 100, { isOut: true, fielderIds: ["f1", "f2"], wicketType: "run_out" })], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 20, 20, 100, { isOut: true, fielderIds: ["f1"], wicketType: "caught_behind" })], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 20, 20, 100, { isOut: true, fielderIds: ["f1"], wicketType: "stumped" })], [])] });
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 20, 20, 100, { isOut: true, fielderIds: ["f1"], wicketType: "retired_out" })], [])] }); // no fielding pts
  // two innings, same players (points accumulate)
  add("calculateMatchMVPPoints", { scorecards: [sc([bat("p1", 40, 30, 133.3)], [bowl("b2", 3)]), sc([bat("p1", 25, 20, 125)], [bowl("b2", 2)])] });
  // replayed real innings (mvp over actual scorecards)
  for (let i = 0; i < 30; i++) {
    const inn1 = fuzzInnings();
    const inn2 = fuzzInnings({ rules: inn1.rules, batters: inn1.bowlingSquadIds.length ? ["q1", "q2", "q3", "q4"] : undefined });
    const pm = playersMapFor([...inn1.battingSquadIds, ...inn1.bowlingSquadIds, ...inn2.battingSquadIds, ...inn2.bowlingSquadIds]);
    const sc1 = scoringEngine.replayInnings(inn1.ballEvents, inn1.rules, inn1.battingSquadIds, inn1.bowlingSquadIds, pm);
    const sc2 = scoringEngine.replayInnings(inn2.ballEvents, inn2.rules, inn2.battingSquadIds, inn2.bowlingSquadIds, pm, sc1.totalRuns + 1);
    add("calculateMatchMVPPoints", { scorecards: i % 2 === 0 ? [sc1, sc2] : [sc1] });
  }
}

// -- 8. calculateTournamentPointsTable: real-ish tournaments
{
  const teamPool = [
    { id: "tA", players: ["a1", "a2", "a3", "a4", "a5", "a6"] },
    { id: "tB", players: ["b1", "b2", "b3", "b4", "b5", "b6"] },
    { id: "tC", players: ["c1", "c2", "c3", "c4", "c5", "c6"] },
    { id: "tD", players: ["d1", "d2", "d3", "d4", "d5", "d6"] },
  ];
  const playersMap = {};
  for (const t of teamPool) for (const p of t.players) playersMap[p] = makePlayer(p);

  function tournamentMatch(o = {}) {
    const rules = o.rules ?? makeRules({ overs: ri(2, 6) });
    const teamA = o.teamA ?? teamPool[0];
    const teamB = o.teamB ?? teamPool[1];
    const inn1 = fuzzInnings({ rules, batters: teamA.players, bowlers: teamB.players.slice(0, 2), n: o.n1 ?? ri(6, 24) });
    const inn2 = o.sameInnings
      ? { ...inn1, ballEvents: inn1.ballEvents, battingSquadIds: teamB.players, bowlingSquadIds: teamA.players.slice(0, 2) }
      : fuzzInnings({ rules, batters: teamB.players, bowlers: teamA.players.slice(0, 2), n: o.n2 ?? ri(6, 24) });
    return {
      rules,
      status: o.status ?? "completed",
      ...(o.winnerTeamId !== undefined ? { winnerTeamId: o.winnerTeamId } : {}),
      ...(o.resultText !== undefined ? { resultText: o.resultText } : {}),
      teamAId: teamA.id,
      teamAPlayerIds: o.noSquads ? undefined : teamA.players,
      teamBPlayerIds: o.noSquads ? undefined : teamB.players,
      innings: [
        { battingTeamId: teamA.id, bowlingTeamId: teamB.id, ballEvents: inn1.ballEvents },
        { battingTeamId: teamB.id, bowlingTeamId: teamA.id, ballEvents: inn2.ballEvents },
      ],
    };
  }
  const ids = teamPool.map((t) => t.id);
  // one match, decided / tied (same innings) / no-result / non-completed / one-innings
  add("calculateTournamentPointsTable", { matches: [tournamentMatch({ winnerTeamId: "tA" })], teamIds: ids, playersMap });
  add("calculateTournamentPointsTable", { matches: [tournamentMatch({ winnerTeamId: "tB" })], teamIds: ids, playersMap });
  add("calculateTournamentPointsTable", { matches: [tournamentMatch({ sameInnings: true })], teamIds: ids, playersMap }); // tie via equal totals
  add("calculateTournamentPointsTable", { matches: [tournamentMatch({})], teamIds: ids, playersMap }); // no winner, unequal totals
  add("calculateTournamentPointsTable", { matches: [tournamentMatch({ status: "live", winnerTeamId: "tA" })], teamIds: ids, playersMap });
  add("calculateTournamentPointsTable", { matches: [{ ...tournamentMatch({ winnerTeamId: "tA" }), innings: [tournamentMatch().innings[0]] }], teamIds: ids, playersMap });
  add("calculateTournamentPointsTable", { matches: [tournamentMatch({ noSquads: true, winnerTeamId: "tA" })], teamIds: ids, playersMap });
  // unknown team in innings (not in teamIds) is skipped
  add("calculateTournamentPointsTable", { matches: [{ ...tournamentMatch({ winnerTeamId: "tX" }), innings: [{ battingTeamId: "tX", bowlingTeamId: "tA", ballEvents: [] }, { battingTeamId: "tA", bowlingTeamId: "tX", ballEvents: [] }] }], teamIds: ids, playersMap });
  // all-out short side (full-quota NRR rule) — 7-player side, 11-a-side rules
  const shortSquad = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
  const rulesShort = makeRules({ overs: 8, playersPerSide: 11, lastManBatting: false });
  const allOutEvents = [];
  for (let i = 0; i < 6; i++) {
    allOutEvents.push(ball({ strikerId: shortSquad[i], nonStrikerId: shortSquad[i + 1], bowlerId: "b1", wicket: wicket({ type: "bowled", dismissedPlayerId: shortSquad[i] }) }));
  }
  add("calculateTournamentPointsTable", {
    matches: [{
      rules: rulesShort, status: "completed", winnerTeamId: "tB",
      teamAId: "tA", teamAPlayerIds: shortSquad, teamBPlayerIds: teamPool[1].players,
      innings: [
        { battingTeamId: "tA", bowlingTeamId: "tB", ballEvents: allOutEvents },
        { battingTeamId: "tB", bowlingTeamId: "tA", ballEvents: fuzzInnings({ rules: rulesShort, batters: teamPool[1].players, bowlers: ["s1", "s2"], n: 30 }).ballEvents },
      ],
    }],
    teamIds: ids, winPoints: 3, tiePoints: 2, nrPoints: 1, playersMap,
  });
  // multi-match fuzz tournaments
  for (let i = 0; i < 40; i++) {
    const nMatches = ri(1, 6);
    const matches = [];
    for (let m = 0; m < nMatches; m++) {
      const a = pick(teamPool);
      let b = pick(teamPool);
      while (b.id === a.id) b = pick(teamPool);
      const w = ri(0, 2);
      matches.push(tournamentMatch({
        teamA: a, teamB: b,
        winnerTeamId: w === 0 ? a.id : w === 1 ? b.id : undefined,
        sameInnings: w === 2 && chance(0.5),
        status: chance(0.9) ? "completed" : "live",
      }));
    }
    add("calculateTournamentPointsTable", {
      matches, teamIds: ids,
      winPoints: chance(0.8) ? undefined : ri(2, 4),
      tiePoints: chance(0.8) ? undefined : ri(1, 2),
      nrPoints: chance(0.8) ? undefined : ri(0, 2),
      playersMap,
    });
  }
}

// -- 9. generateRoundRobinFixtures
{
  add("generateRoundRobinFixtures", { teamIds: [], tournamentId: mk("t") });
  add("generateRoundRobinFixtures", { teamIds: ["t1"], tournamentId: mk("t") });
  add("generateRoundRobinFixtures", { teamIds: ["t1", "t2"], tournamentId: mk("t") });
  add("generateRoundRobinFixtures", { teamIds: ["t1", "t2", "t3"], tournamentId: mk("t") });
  add("generateRoundRobinFixtures", { teamIds: ["t1", "t2", "t3", "t4"], tournamentId: mk("t") });
  add("generateRoundRobinFixtures", { teamIds: ["t1", "t2", "t3", "t4", "t5"], tournamentId: mk("t") });
  add("generateRoundRobinFixtures", { teamIds: ["t1", "t2", "t3", "t4", "t5", "t6", "t7"], tournamentId: mk("t") });
}

// -- 10. generateBallCommentary
{
  for (const t of WICKET_TYPES) {
    add("generateBallCommentary", { ball: { runsBat: 0, extraType: "none", extraRuns: 0, isLegal: true, wicket: wicket({ type: t }) }, strikerName: "Ravi", bowlerName: "Arun" });
  }
  for (const extraType of ["none", "wide", "no_ball", "bye", "leg_bye", "penalty"]) {
    for (const runs of [0, 1, 2, 3, 4, 6, 5]) {
      add("generateBallCommentary", { ball: { runsBat: runs, extraType, extraRuns: runs === 2 ? 2 : 1, isLegal: extraType === "none" }, strikerName: "Zoë", bowlerName: "李伟" });
    }
  }
  add("generateBallCommentary", { ball: { runsBat: 4, extraType: "none", extraRuns: 0, isLegal: true, shotDirection: "cover" }, strikerName: "Ravi", bowlerName: "Arun" });
  add("generateBallCommentary", { ball: { runsBat: 6, extraType: "none", extraRuns: 0, isLegal: true, shotDirection: "long_on" }, strikerName: "Ravi", bowlerName: "Arun" });
  add("generateBallCommentary", { ball: { runsBat: 1, extraType: "none", extraRuns: 0, isLegal: true, shotDirection: "fine_leg" }, strikerName: "Ravi", bowlerName: "Arun" });
}

// -- 11. calculateLiveWinProbability (full Match + real scorecards)
{
  const squadA = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const squadB = ["b1", "b2", "b3", "b4", "b5", "b6"];
  function makeMatch(o = {}) {
    const rules = o.rules ?? makeRules({ overs: ri(2, 6) });
    const idx = o.currentInningsIndex ?? 0;
    const innings = [];
    if (idx >= 0) innings.push({ battingTeamId: "tA", bowlingTeamId: "tB", ballEvents: o.inn1Events ?? [] });
    if (idx >= 1) innings.push({ battingTeamId: o.secondBattingTeamId ?? "tB", bowlingTeamId: "tA", ballEvents: o.inn2Events ?? [], ...(o.targetRuns !== undefined ? { targetRuns: o.targetRuns } : {}) });
    return {
      id: mk("m"), teamAId: "tA", teamBId: "tB",
      teamAPlayerIds: o.squadA ?? squadA, teamBPlayerIds: o.squadB ?? squadB,
      date: "2026-11-15", venue: "Oval Maidan", rules,
      status: o.status ?? "live", currentInningsIndex: idx, innings,
      ...(o.winnerTeamId !== undefined ? { winnerTeamId: o.winnerTeamId } : {}),
      updatedAt: 1763000000000,
    };
  }
  // 1st innings: various stages + ball types + h2h factors
  for (let i = 0; i < 40; i++) {
    const rules = makeRules({ overs: ri(2, 8) });
    const inn = fuzzInnings({ rules, batters: squadA, bowlers: squadB.slice(0, 3), n: ri(0, 24) });
    const pm = playersMapFor([...squadA, ...squadB]);
    const sc = scoringEngine.replayInnings(inn.ballEvents, inn.rules, inn.battingSquadIds, inn.bowlingSquadIds, pm);
    const m = makeMatch({ rules, inn1Events: inn.ballEvents, currentInningsIndex: 0, squadB: inn.bowlingSquadIds.length >= 2 ? squadB : ["b1", "b2"] });
    add("calculateLiveWinProbability", {
      match: m, currentScorecard: sc,
      ...(chance(0.6) ? { headToHeadFactor: pick([0.2, 0.5, 0.8, 0.62]) } : {}),
    });
  }
  // 2nd innings chase states (hand-built scorecards for exact branches)
  const chaseStates = [
    { totalRuns: 50, totalWickets: 2, legalBallsCount: 24, targetRuns: 60 },
    { totalRuns: 59, totalWickets: 2, legalBallsCount: 24, targetRuns: 60 },
    { totalRuns: 60, totalWickets: 2, legalBallsCount: 24, targetRuns: 60 },  // target reached
    { totalRuns: 30, totalWickets: 9, legalBallsCount: 30, targetRuns: 60 },  // wickets gone
    { totalRuns: 40, totalWickets: 4, legalBallsCount: 36, targetRuns: 60 },  // overs exhausted
    { totalRuns: 54, totalWickets: 4, legalBallsCount: 42, targetRuns: 60 },  // need 6 off 6
    { totalRuns: 58, totalWickets: 4, legalBallsCount: 47, targetRuns: 60 },  // need 2 off 1
    { totalRuns: 59, totalWickets: 4, legalBallsCount: 48, targetRuns: 60 },  // tie level, no balls left
    { totalRuns: 10, totalWickets: 0, legalBallsCount: 0, targetRuns: 60 },   // start of chase
    { totalRuns: 52, totalWickets: 8, legalBallsCount: 42, targetRuns: 60 },  // tail chase
  ];
  for (const st of chaseStates) {
    const m = makeMatch({ currentInningsIndex: 1, inn2Events: [ball()] });
    const sc = makeScorecard({ ...st, inningsIndex: 1, battingTeamId: "tB", bowlingTeamId: "tA" });
    add("calculateLiveWinProbability", { match: m, currentScorecard: sc });
    add("calculateLiveWinProbability", { match: m, currentScorecard: sc, firstInningsTotal: 59 });
    add("calculateLiveWinProbability", { match: { ...m, teamAId: "tB", teamBId: "tA" }, currentScorecard: sc, firstInningsTotal: 59, headToHeadFactor: 0.3 });
  }
  // real replayed 2nd innings
  for (let i = 0; i < 20; i++) {
    const rules = makeRules({ overs: ri(2, 5) });
    const inn1 = fuzzInnings({ rules, batters: squadA, bowlers: squadB.slice(0, 3), n: ri(12, 30) });
    const pm = playersMapFor([...squadA, ...squadB]);
    const sc1 = scoringEngine.replayInnings(inn1.ballEvents, rules, squadA, squadB, pm);
    const inn2 = fuzzInnings({ rules, batters: squadB, bowlers: squadA.slice(0, 3), n: ri(0, 24) });
    const sc2 = scoringEngine.replayInnings(inn2.ballEvents, rules, squadB, squadA, pm, sc1.totalRuns + 1);
    const m = makeMatch({ rules, inn1Events: inn1.ballEvents, inn2Events: inn2.ballEvents, currentInningsIndex: 1, targetRuns: sc1.totalRuns + 1 });
    add("calculateLiveWinProbability", { match: m, currentScorecard: sc2, firstInningsTotal: sc1.totalRuns });
  }
  // currentInningsIndex out of range (squad fallback path)
  const mOOR = makeMatch({ currentInningsIndex: 5, inn1Events: [ball()], inn2Events: [ball()] });
  add("calculateLiveWinProbability", { match: mOOR, currentScorecard: makeScorecard({ totalRuns: 20, totalWickets: 1, legalBallsCount: 12 }) });
}

// -- 12. calculateProjectedScore grid
{
  for (const ballType of ["tennis", "leather", "box", "other"]) {
    for (const [runs, balls, overs, wkts, total] of [
      [0, 0, 6, 0, 10], [30, 24, 6, 1, 10], [60, 48, 6, 3, 10], [45, 50, 6, 6, 10],
      [80, 60, 6, 8, 10], [20, 12, 4, 0, 9], [55, 30, 5, 2, 8], [10, 6, 2, 1, 5],
      [0, 36, 6, 0, 10], [100, 60, 6, 0, 10],
    ]) {
      add("calculateProjectedScore", { currentRuns: runs, legalBallsFaced: balls, totalOvers: overs, wicketsLost: wkts, totalWickets: total, ballType });
    }
  }
  add("calculateProjectedScore", { currentRuns: 30, legalBallsFaced: 24, totalOvers: 6, wicketsLost: 2, totalWickets: 10 }); // default ballType
}

// -- 13. calculateBatterProjection ladder
{
  for (const [runs, balls, rem, wkts] of [
    [0, 0, 30, 10], [0, 10, 30, 10], [5, 10, 30, 10], [29, 25, 30, 10], [30, 25, 30, 10],
    [49, 40, 36, 8], [50, 40, 36, 8], [99, 60, 24, 6], [100, 60, 24, 6], [130, 80, 12, 4],
    [10, 5, 3, 1], [10, 5, 3, 2], [20, 50, 12, 2], [25, 10, 1, 2], [0, 0, 0, 0],
  ]) {
    add("calculateBatterProjection", { currentRuns: runs, ballsFaced: balls, legalBallsRemainingInInnings: rem, teamWicketsRemaining: wkts });
  }
}

// -- 14. calculatePreMatchPrediction
{
  const teamA = { id: "tA", name: "Thunder XI", shortName: "THU", color: "#2563EB", monogram: "TX", playerIds: ["a1", "a2"], createdAt: 1700000000000 };
  const teamB = { id: "tB", name: "Box Cafe CC", shortName: "BOX", color: "#059669", monogram: "BC", playerIds: ["b1", "b2"], createdAt: 1700000000000 };
  const teamC = { id: "tC", name: "Oval Locals", shortName: "OVL", color: "#D97706", monogram: "OL", playerIds: ["c1", "c2"], createdAt: 1700000000000 };
  const rules = makeRules({ overs: 6 });
  function historyMatch(a, b, winner, o = {}) {
    return {
      id: mk("m"), teamAId: a.id, teamBId: b.id,
      teamAPlayerIds: a.playerIds, teamBPlayerIds: b.playerIds,
      date: o.date ?? "2026-10-0" + ri(1, 9), venue: o.venue ?? "Oval Maidan",
      rules: o.rules ?? rules, status: "completed", currentInningsIndex: 1,
      innings: [
        { battingTeamId: a.id, bowlingTeamId: b.id, ballEvents: o.batFirst === false ? [] : [ball()] },
        { battingTeamId: b.id, bowlingTeamId: a.id, ballEvents: o.batFirst === false ? [ball()] : [] },
      ],
      ...(winner ? { winnerTeamId: winner } : {}),
      updatedAt: o.updatedAt ?? 1762000000000 + ri(0, 1000),
    };
  }
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: [], rules });
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: [], rules, venue: "Oval Maidan" });
  // 1..4 head-to-head with varying winners
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: [historyMatch(teamA, teamB, "tA")], rules });
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: [historyMatch(teamA, teamB, "tB"), historyMatch(teamA, teamB, "tA")], rules });
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: [historyMatch(teamA, teamB, "tA"), historyMatch(teamA, teamB, "tA"), historyMatch(teamB, teamA, "tB"), historyMatch(teamA, teamB, "tA")], rules });
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: [historyMatch(teamA, teamB, "tA"), historyMatch(teamA, teamB, "tA"), historyMatch(teamA, teamB, undefined)], rules, venue: "Oval Maidan" });
  // other teams' matches (form-only path) + venue bias
  const many = [];
  for (let i = 0; i < 6; i++) many.push(historyMatch(teamA, teamC, i % 3 === 0 ? "tC" : "tA", { venue: "Oval Maidan" }));
  for (let i = 0; i < 3; i++) many.push(historyMatch(teamB, teamC, "tB", { venue: "Box Ground" }));
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: many, rules });
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: many, rules, venue: "Oval Maidan" });
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: many, rules, venue: "Box Ground" });
  // bat-first winners at a venue (toss advantage)
  const batFirst = [];
  for (let i = 0; i < 4; i++) batFirst.push(historyMatch(teamA, teamC, "tA", { venue: "Oval Maidan", batFirst: true }));
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: batFirst, rules, venue: "Oval Maidan" });
  const bowlFirst = [];
  for (let i = 0; i < 4; i++) bowlFirst.push(historyMatch(teamB, teamC, "tC", { venue: "Oval Maidan", batFirst: false }));
  add("calculatePreMatchPrediction", { teamA, teamB, allMatches: bowlFirst, rules, venue: "Oval Maidan" });
  // 10-round fuzz histories
  for (let i = 0; i < 10; i++) {
    const n = ri(0, 6);
    const allMatches = [];
    for (let k = 0; k < n; k++) {
      const a = pick([teamA, teamB, teamC]);
      let b = pick([teamA, teamB, teamC]);
      while (b.id === a.id) b = pick([teamA, teamB, teamC]);
      allMatches.push(historyMatch(a, b, chance(0.8) ? (chance(0.5) ? a.id : b.id) : undefined, { venue: pick(["Oval Maidan", "Box Ground", "School Ground"]) }));
    }
    add("calculatePreMatchPrediction", {
      teamA: chance(0.3) ? teamC : teamA, teamB, allMatches, rules: makeRules({ overs: ri(2, 10) }),
      ...(chance(0.5) ? { venue: "Oval Maidan" } : {}),
    });
  }
}

// -- 15. simulateTournamentOutcomes — deterministic branch only (Math.random
//    cannot be seeded; the random branch is outside the recorded contract)
{
  const row = (teamId, played, won, tied, points, nrr) => ({
    teamId, played, won, lost: played - won - tied, tied, noResult: 0, points, nrr,
    runsScored: 100 + ri(0, 100), oversFaced: 20 + ri(0, 20), runsConceded: 100 + ri(0, 100), oversBowled: 20 + ri(0, 20),
  });
  const t = (teamIds, winPoints = 2, tiePoints = 1) => ({
    id: mk("tour"), name: "Gully Cup", format: "round_robin", teamIds,
    rules: makeRules({ overs: 6 }), status: "in_progress",
    winPoints, tiePoints, nrPoints: 1, createdAt: 1763000000000,
  });
  const doneFixture = (a, b) => ({ id: mk("fix"), tournamentId: "tour", roundName: "Round 1", teamAId: a, teamBId: b, matchId: mk("m"), status: "completed" });
  add("simulateTournamentOutcomes", { tournament: t(["tA", "tB"]), fixtures: [doneFixture("tA", "tB")], completedMatches: [], currentPointsTable: [row("tA", 2, 2, 0, 4, 0.35), row("tB", 2, 0, 0, 0, -0.35)], iterations: 200 });
  add("simulateTournamentOutcomes", { tournament: t(["tA", "tB", "tC"]), fixtures: [doneFixture("tA", "tB"), doneFixture("tC", "tA"), doneFixture("tB", "tC")], completedMatches: [], currentPointsTable: [row("tA", 2, 1, 1, 3, 0.12), row("tB", 2, 1, 0, 2, -0.2), row("tC", 2, 0, 1, 1, 0.08)] });
  add("simulateTournamentOutcomes", { tournament: t(["tA"], 3, 2), fixtures: [], completedMatches: [], currentPointsTable: [row("tA", 1, 1, 0, 3, 0.5)] });
  add("simulateTournamentOutcomes", { tournament: t(["tA", "tB", "tC", "tD"]), fixtures: [], completedMatches: [], currentPointsTable: [] });
  add("simulateTournamentOutcomes", { tournament: t(["tA", "tB"]), fixtures: [], completedMatches: [], currentPointsTable: [row("tA", 0, 0, 0, 0, 0), row("tB", 0, 0, 0, 0, 0)], iterations: 50 });
}

// -- 16. calculateNrrScenario
{
  const row = (teamId, o = {}) => ({
    teamId, played: o.played ?? 2, won: o.won ?? 1, lost: 1, tied: 0, noResult: 0,
    points: o.points ?? 2, nrr: o.nrr ?? 0.1,
    runsScored: o.runsScored ?? 120, oversFaced: o.oversFaced ?? 20,
    runsConceded: o.runsConceded ?? 110, oversBowled: o.oversBowled ?? 20,
  });
  const rules = makeRules({ overs: 8 });
  add("calculateNrrScenario", { teamAId: "tA", teamBId: "tB", targetTeamId: "tB", pointsTable: [row("tA"), row("tB", { nrr: 0.4 })], matchRules: rules });
  add("calculateNrrScenario", { teamAId: "tA", teamBId: "tB", targetTeamId: "tC", pointsTable: [row("tA")], matchRules: rules }); // missing rows
  add("calculateNrrScenario", { teamAId: "tA", teamBId: "tB", targetTeamId: "tA", pointsTable: [row("tA"), row("tB")], matchRules: rules }); // target = self
  add("calculateNrrScenario", { teamAId: "tA", teamBId: "tB", targetTeamId: "tB", pointsTable: [], matchRules: rules }); // empty table
  add("calculateNrrScenario", { teamAId: "tA", teamBId: "tB", targetTeamId: "tB", pointsTable: [row("tA", { nrr: -0.75, runsScored: 60, oversFaced: 15, runsConceded: 90, oversBowled: 18 }), row("tB", { nrr: 0.9 })], matchRules: makeRules({ overs: 2 }) });
  for (let i = 0; i < 10; i++) {
    add("calculateNrrScenario", {
      teamAId: "tA", teamBId: "tB", targetTeamId: pick(["tA", "tB", "tC"]),
      pointsTable: [row("tA", { nrr: -1 + rand() * 2, runsScored: ri(20, 300), oversFaced: ri(5, 40), runsConceded: ri(20, 300), oversBowled: ri(5, 40) }), row("tB", { nrr: -1 + rand() * 2 })],
      matchRules: makeRules({ overs: ri(2, 20) }),
    });
  }
}

// -- 17. calculatePlayerDetailedStats (recorded from the verified work copy)
{
  const pIds = ["x1", "x2", "x3", "x4", "x5", "x6", "x7"];
  const fielders = ["f1", "f2"];
  const playersMap = {};
  for (const p of [...pIds, ...fielders]) playersMap[p] = makePlayer(p);
  const teamsMap = {
    tR: { id: "tR", name: "Rust CC", shortName: "RCC", color: "#2563EB", monogram: "RC", playerIds: ["x1", "x2", "x3", "x4"], createdAt: 1700000000000 },
    tO: { id: "tO", name: "Oval Locals", shortName: "OVL", color: "#D97706", monogram: "OL", playerIds: ["x1", "x5", "x6"], createdAt: 1700000000000 },
    tN: { id: "tN", name: "", shortName: "", color: "#059669", monogram: "NN", playerIds: ["x9"], createdAt: 1700000000000 }, // empty names → fallbacks
  };
  function statsMatch(o = {}) {
    const rules = o.rules ?? makeRules({ overs: ri(2, 6) });
    const innings = [];
    const n = o.inningsCount ?? ri(0, 2);
    for (let i = 0; i < n; i++) {
      const batting = i === 0 ? "tR" : o.secondBatting ?? "tO";
      const squad = batting === "tR" ? pIds.slice(0, 5) : pIds.slice(2, 7);
      const inn = fuzzInnings({ rules, batters: squad, bowlers: ["x6", "x7"], n: ri(0, 24) });
      innings.push({
        battingTeamId: batting, bowlingTeamId: batting === "tR" ? "tO" : "tR",
        ...(o.targetRuns !== undefined && i > 0 ? { targetRuns: o.targetRuns } : {}),
        ...(o.superOver ? { isSuperOver: true } : {}),
        ballEvents: inn.ballEvents,
      });
    }
    return {
      id: mk("m"), teamAId: "tR", teamBId: "tO",
      teamAPlayerIds: pIds.slice(0, 5), teamBPlayerIds: pIds.slice(2, 7),
      date: o.date ?? "2026-11-1" + ri(0, 9), venue: o.venue ?? (chance(0.3) ? "" : pick(["Oval Maidan", "Box Ground"])),
      rules, status: o.status ?? "completed", currentInningsIndex: Math.max(0, innings.length - 1),
      innings,
      ...(o.winnerTeamId !== undefined ? { winnerTeamId: o.winnerTeamId } : {}),
      ...(o.resultText !== undefined ? { resultText: o.resultText } : {}),
      ...(o.potm !== undefined ? { playerOfTheMatchId: o.potm } : {}),
      updatedAt: o.updatedAt ?? 1762000000000 + ri(0, 5000),
    };
  }
  // empty / unknown player
  add("calculatePlayerDetailedStats", { playerId: "nobody", matches: [], playersMap, teamsMap });
  add("calculatePlayerDetailedStats", { playerId: "x1", matches: [], playersMap, teamsMap });
  // single match variants
  add("calculatePlayerDetailedStats", { playerId: "x1", matches: [statsMatch({ inningsCount: 0 })], playersMap, teamsMap });
  add("calculatePlayerDetailedStats", { playerId: "x1", matches: [statsMatch({ inningsCount: 1, winnerTeamId: "tR", potm: "x1", resultText: "Rust CC won by 20 runs" })], playersMap, teamsMap });
  add("calculatePlayerDetailedStats", { playerId: "x1", matches: [statsMatch({ inningsCount: 2, winnerTeamId: "tO" })], playersMap, teamsMap });
  add("calculatePlayerDetailedStats", { playerId: "x1", matches: [statsMatch({ inningsCount: 2, targetRuns: 45, superOver: true })], playersMap, teamsMap });
  add("calculatePlayerDetailedStats", { playerId: "x1", matches: [statsMatch({ status: "live" })], playersMap, teamsMap }); // unfinished match still counts
  // player only appears in EVENTS (not in team lists)
  const evOnly = statsMatch({ inningsCount: 2 });
  const b0 = { ...ball({ bowlerId: "x6", strikerId: "x2", nonStrikerId: "x3" }) };
  evOnly.innings[0].ballEvents = [b0, ...evOnly.innings[0].ballEvents];
  add("calculatePlayerDetailedStats", { playerId: "x6", matches: [evOnly], playersMap, teamsMap });
  // same updatedAt (stable sort) + shuffled chronological order
  add("calculatePlayerDetailedStats", { playerId: "x1", matches: [statsMatch({ updatedAt: 1762000000000, date: "2026-11-10" }), statsMatch({ updatedAt: 1762000000000, date: "2026-11-11" }), statsMatch({ updatedAt: 1762000000000, date: "2026-11-12" })], playersMap, teamsMap });
  // multi-match fuzz (batter / bowler / fielder focus)
  for (let i = 0; i < 30; i++) {
    const nMatches = ri(1, 6);
    const matches = [];
    for (let m = 0; m < nMatches; m++) {
      matches.push(statsMatch({
        winnerTeamId: chance(0.8) ? pick(["tR", "tO"]) : undefined,
        potm: chance(0.3) ? pick(pIds) : undefined,
        resultText: chance(0.5) ? "Some result" : undefined,
      }));
    }
    add("calculatePlayerDetailedStats", { playerId: pick([...pIds, "f1"]), matches, playersMap, teamsMap });
  }
}

// ----------------------------------------------------- record-from-workcopy
// playerStatsEngine imports the app's storage layer for its DEFAULT
// arguments; the override path never touches it. Refresh the copy, assert
// the engine files are byte-identical to the originals, stub ONLY that
// import, then dynamically import it.
const RN = new URL("../../GullyScoreRN", import.meta.url).pathname;
const WORK = new URL("../work", import.meta.url).pathname;
const COPY = `${WORK}/GullyScoreRN`;
const ENGINE_FILES = [
  "src/engine/scoringEngine.ts",
  "src/engine/playerStatsEngine.ts",
  "src/engine/predictionEngine.ts",
  "src/types/cricket.ts",
];
mkdirSync(WORK, { recursive: true });
// fresh copy of the ORIGINAL every run (bun's cpSync proved unreliable about
// overwriting/creating the tree — plain cp -a is the dependable tool), so the
// engine files are provably byte-identical before the stub goes in
rmSync(COPY, { recursive: true, force: true });
execSync(`cp -a "${RN}" "${WORK}/"`, { stdio: "pipe" });
for (const f of ENGINE_FILES) {
  const a = readFileSync(`${RN}/${f}`);
  const b = readFileSync(`${COPY}/${f}`);
  if (Buffer.compare(a, b) !== 0) throw new Error(`work copy differs from original: ${f}`);
}
const PSTATS = `${COPY}/src/engine/playerStatsEngine.ts`;
const DB_IMPORT = 'import { db } from "../storage/db";';
const DB_STUB = 'const db: any = { getPlayersMap: () => { throw new Error("no db in recorder") }, getMatches: () => { throw new Error("no db in recorder") }, getTeamsMap: () => { throw new Error("no db in recorder") } };';
let pstatsSrc = readFileSync(PSTATS, "utf8");
if (pstatsSrc.includes(DB_IMPORT)) {
  pstatsSrc = pstatsSrc.replace(DB_IMPORT, DB_STUB);
  writeFileSync(PSTATS, pstatsSrc);
} else if (!pstatsSrc.includes("no db in recorder")) {
  throw new Error("playerStatsEngine.ts: db import not found and not stubbed — refusing to record");
}
const { calculatePlayerDetailedStats } = await import(`${COPY}/src/engine/playerStatsEngine.ts`);

// ------------------------------------------------------------- run + record
function runOriginal(fn, args) {
  try {
    switch (fn) {
      case "formatOvers": return { value: scoringEngine.formatOvers(args.legalBalls) };
      case "parseOversToDecimal": return { value: scoringEngine.parseOversToDecimal(args.legalBalls) };
      case "ballsToOversFraction": return { value: scoringEngine.ballsToOversFraction(args.legalBalls) };
      case "isDismissalCreditedToBowler": return { value: scoringEngine.isDismissalCreditedToBowler(args.type) };
      case "deriveLiveCrease": return { value: scoringEngine.deriveLiveCrease(args.ballEvents, args.rules, args.battingSquadIds, args.bowlingSquadIds) };
      case "getDismissalText": return { value: scoringEngine.getDismissalText(args.dismissal, args.playersMap, args.bowlerId) };
      case "replayInnings": return { value: scoringEngine.replayInnings(args.ballEvents, args.rules, args.battingSquadIds, args.bowlingSquadIds, args.playersMap, args.targetRuns, args.isSuperOver) };
      case "calculateMatchMVPPoints": return { value: scoringEngine.calculateMatchMVPPoints(args.scorecards) };
      case "calculateTournamentPointsTable": return { value: scoringEngine.calculateTournamentPointsTable(args.matches, args.teamIds, args.winPoints, args.tiePoints, args.nrPoints, args.playersMap) };
      case "generateRoundRobinFixtures": return { value: scoringEngine.generateRoundRobinFixtures(args.teamIds, args.tournamentId) };
      case "generateBallCommentary": return { value: scoringEngine.generateBallCommentary(args.ball, args.strikerName, args.bowlerName) };
      case "calculateLiveWinProbability": return { value: predictionEngine.calculateLiveWinProbability(args.match, args.currentScorecard, args.firstInningsTotal, args.headToHeadFactor) };
      case "calculateProjectedScore": return { value: predictionEngine.calculateProjectedScore(args.currentRuns, args.legalBallsFaced, args.totalOvers, args.wicketsLost, args.totalWickets, args.ballType) };
      case "calculateBatterProjection": return { value: predictionEngine.calculateBatterProjection(args.currentRuns, args.ballsFaced, args.legalBallsRemainingInInnings, args.teamWicketsRemaining) };
      case "calculatePreMatchPrediction": return { value: predictionEngine.calculatePreMatchPrediction(args.teamA, args.teamB, args.allMatches, args.rules, args.venue) };
      case "simulateTournamentOutcomes": return { value: predictionEngine.simulateTournamentOutcomes(args.tournament, args.fixtures, args.completedMatches, args.currentPointsTable, args.iterations) };
      case "calculateNrrScenario": return { value: predictionEngine.calculateNrrScenario(args.teamAId, args.teamBId, args.targetTeamId, args.pointsTable, args.matchRules) };
      case "calculatePlayerDetailedStats": return { value: calculatePlayerDetailedStats(args.playerId, args.matches, args.playersMap, args.teamsMap) };
      default: throw new Error(`unknown fn: ${fn}`);
    }
  } catch (e) {
    return { threw: e?.constructor?.name ?? String(e) };
  }
}

const lines = [];
const counts = {};
let threwCount = 0;
for (const c of cases) {
  const r = runOriginal(c.fn, c.args);
  counts[c.fn] = (counts[c.fn] ?? 0) + 1;
  if (r.threw !== undefined) threwCount++;
  lines.push(JSON.stringify({
    id: c.id,
    fn: c.fn,
    args: c.args,
    expected: r.threw !== undefined ? { $threw: r.threw } : r.value,
  }));
}

const LAB_ROOT = new URL("..", import.meta.url).pathname;
writeFileSync(`${LAB_ROOT}cases.jsonl`, lines.join("\n") + "\n");

// fingerprint of the ported units' sources — the stale-recording guard
function fingerprint(relPath) {
  const abs = new URL(`../../${relPath}`, import.meta.url).pathname;
  const buf = readFileSync(abs);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
    lines: buf.toString("utf8").split("\n").length,
  };
}
const recordedFrom = {
  schema: "rust-anything-lab/recorded-from@1",
  recordedAt: new Date().toISOString(),
  seed: 0xc0ffee,
  files: {
    "GullyScoreRN/src/engine/scoringEngine.ts": fingerprint("GullyScoreRN/src/engine/scoringEngine.ts"),
    "GullyScoreRN/src/engine/playerStatsEngine.ts": fingerprint("GullyScoreRN/src/engine/playerStatsEngine.ts"),
    "GullyScoreRN/src/engine/predictionEngine.ts": fingerprint("GullyScoreRN/src/engine/predictionEngine.ts"),
    "GullyScoreRN/src/types/cricket.ts": fingerprint("GullyScoreRN/src/types/cricket.ts"),
  },
};
writeFileSync(`${LAB_ROOT}recorded-from.json`, JSON.stringify(recordedFrom, null, 2) + "\n");

console.log(`recorded ${lines.length} cases -> cases.jsonl`);
for (const [fn, n] of Object.entries(counts)) console.log(`  ${fn}: ${n}`);
if (threwCount > 0) console.log(`  ($threw markers: ${threwCount})`);
console.log("fingerprint -> recorded-from.json (4 engine files)");
