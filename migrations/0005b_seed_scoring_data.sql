-- Seeds scoring_categories/scoring_items with exactly what scoring-data.js
-- (now retired) used to hardcode, so nothing changes for players on the
-- night this migration ships — every existing rule reappears, just
-- editable from the admin center from here on.

INSERT INTO scoring_categories (id, title, kind, sort_order) VALUES
  (1, 'Standard Points — available every league night', 'pos', 1),
  (2, 'Rotating Points — these change regularly', 'pos', 2),
  (3, 'Bad Guy Points — don''t do this stuff', 'neg', 3);

INSERT INTO scoring_items (category_id, val, dq, desc, sort_order) VALUES
  (1, 1, 0, 'Game ends in a draw (more than one player alive at round''s end). 1pt each.', 1),
  (1, 1, 0, 'Win without playing a Game Changer or a T1 Sol Ring.', 2),
  (1, 1, 0, 'Win or eliminate a player with an alternate win condition (poison, commander damage, milling, “win the game” cards). Once per match. No empty-library/Lab Man wins.', 3),
  (1, 1, 0, 'Remove or counter 2+ permanents/spells in a game with single-target removal/counters.', 4),
  (1, 1, 0, 'Stop a win attempt (fog a lethal swing, counter a game-winning spell). Once per match. Be realistic.', 5),
  (1, 1, 0, 'Protect another player from being killed. Once per game.', 6),
  (1, 1, 0, 'Cast your commander from the command zone 4+ times. Excludes recasting infinites (Prossh). NOT Yuriko.', 7),
  (1, 1, 0, 'Have a commander from the most recent Universes Beyond / Universes Within set.', 8),
  (1, 1, 0, 'Be in seat four and lose the game, or play in a three-player pod.', 9),
  (1, 1, 0, 'Coolest card played (all players vote). Most votes wins; no consensus = no point.', 10),

  (2, 1, 0, 'Cast 2 spells with Convoke, Improvise, Waterbending, or Teamwork.', 1),
  (2, 1, 0, 'Control 5+ unique non-token creature members of a team at once (Gatewatch, Fellowship, Avengers, Weatherlight crew).', 2),
  (2, 1, 0, 'Cast a Prepared or Adventure spell three or more times.', 3),
  (2, 1, 0, 'Lightning Bolted! Kill a player with a direct-damage instant/sorcery when they are at 3 or less life.', 4),
  (2, 1, 0, 'Lightning Bolt range! Win or eliminate a player while your own life total is three or less.', 5),

  (3, -4, 0, 'Win the game before turn 6.', 1),
  (3, -2, 0, 'Control 4+ stax pieces at one time.', 2),
  (3, -1, 0, 'Win with an infinite combo.', 3),
  (3, -1, 0, 'Play a commander / commander pair on the front page of edhtop16.com.', 4),
  (3, -6, 0, 'Present an infinite mana/draw loop and fail to end the game immediately.', 5),
  (3, -2, 0, 'Acted like a jerk. You know what you did.', 6),
  (3, 0, 1, 'Mass Land Denial. (Disqualification)', 7),
  (3, 0, 1, 'Play a banned card. (Disqualification)', 8),
  (3, 0, 1, 'Chain Extra Turns. (Disqualification)', 9);
