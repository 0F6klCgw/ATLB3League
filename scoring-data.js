// Canonical scoring rules — the single source both formsubmission.html
// (digital entry) and printsheet.html (blank paper copy) render from, so
// the two can never drift apart. This is also what lets the site's Points
// Sheet eventually retire the Google Sheet entirely: it's already the real
// source of truth, not a mirror of one.
const SECTIONS = [
  { title: "Standard Points — available every league night", kind:"pos", items:[
    { key:"draw", val:1, desc:"Game ends in a draw (more than one player alive at round's end). 1pt each." },
    { key:"win_no_gc_solring", val:1, desc:"Win without playing a Game Changer or a T1 Sol Ring." },
    { key:"alt_win", val:1, desc:"Win or eliminate a player with an alternate win condition (poison, commander damage, milling, “win the game” cards). Once per match. No empty-library/Lab Man wins." },
    { key:"remove_counter_2plus", val:1, desc:"Remove or counter 2+ permanents/spells in a game with single-target removal/counters." },
    { key:"stop_win", val:1, desc:"Stop a win attempt (fog a lethal swing, counter a game-winning spell). Once per match. Be realistic." },
    { key:"protect_player", val:1, desc:"Protect another player from being killed. Once per game." },
    { key:"cast_cmdr_4x", val:1, desc:"Cast your commander from the command zone 4+ times. Excludes recasting infinites (Prossh). NOT Yuriko." },
    { key:"recent_ub_uw_cmdr", val:1, desc:"Have a commander from the most recent Universes Beyond / Universes Within set." },
    { key:"seat4_loss_or_3pod", val:1, desc:"Be in seat four and lose the game, or play in a three-player pod." },
    { key:"coolest_card", val:1, desc:"Coolest card played (all players vote). Most votes wins; no consensus = no point." },
  ]},
  { title: "Rotating Points — these change regularly", kind:"pos", items:[
    { key:"convoke_improvise_2", val:1, desc:"Cast 2 spells with Convoke, Improvise, Waterbending, or Teamwork." },
    { key:"team_creatures_5", val:1, desc:"Control 5+ unique non-token creature members of a team at once (Gatewatch, Fellowship, Avengers, Weatherlight crew)." },
    { key:"prepared_adventure_3", val:1, desc:"Cast a Prepared or Adventure spell three or more times." },
    { key:"lightning_bolted", val:1, desc:"Lightning Bolted! Kill a player with a direct-damage instant/sorcery when they are at 3 or less life." },
    { key:"lightning_bolt_range", val:1, desc:"Lightning Bolt range! Win or eliminate a player while your own life total is three or less." },
  ]},
  { title: "Bad Guy Points — don't do this stuff", kind:"neg", items:[
    { key:"win_before_t6", val:-4, desc:"Win the game before turn 6." },
    { key:"stax_4plus", val:-2, desc:"Control 4+ stax pieces at one time." },
    { key:"infinite_combo_win", val:-1, desc:"Win with an infinite combo." },
    { key:"edhtop16_cmdr", val:-1, desc:"Play a commander / commander pair on the front page of edhtop16.com." },
    { key:"infinite_loop_fail", val:-6, desc:"Present an infinite mana/draw loop and fail to end the game immediately." },
    { key:"acted_jerk", val:-2, desc:"Acted like a jerk. You know what you did." },
    { key:"mass_land_denial", dq:true, desc:"Mass Land Denial. (Disqualification)" },
    { key:"banned_card", dq:true, desc:"Play a banned card. (Disqualification)" },
    { key:"chain_extra_turns", dq:true, desc:"Chain Extra Turns. (Disqualification)" },
  ]},
];
const PLACEMENTS = [
  { label:"1st", val:4 }, { label:"2nd", val:3 }, { label:"3rd", val:2 }, { label:"4th", val:1 }, { label:"None", val:0 },
];
const GAMES = [1,2,3];
