// Placement is a fixed structural concept (finishing position 1st-4th or
// none) shared by formsubmission.html and printsheet.html — unlike the
// scoring categories/items themselves, which now live in D1 and are
// fetched at runtime from /api/scoring (editable from the admin center's
// Scoring tab), placement isn't admin-editable, so it stays here as plain
// data.
const PLACEMENTS = [
  { label:"1st", val:4 }, { label:"2nd", val:3 }, { label:"3rd", val:2 }, { label:"4th", val:1 }, { label:"None", val:0 },
];
const GAMES = [1,2,3];
