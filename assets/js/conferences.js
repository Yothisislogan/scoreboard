// League structure: college conference tiers and NFL divisions.
// ESPN identifies college conferences by numeric "group" ids, which are
// stable across seasons even when membership changes.

export const FBS_GROUP_ID = '80';
export const FCS_GROUP_ID = '81';

export const COLLEGE_TIERS = {
  power: { slug: 'power-4', label: 'Power 4' },
  group: { slug: 'group-of-6', label: 'Group of 6' },
  independent: { slug: 'independents', label: 'Independents' },
};

// Ordered the way the sidebar lists them. Membership comes from the live
// data (each team carries its conferenceId), so only names and tiers live here.
export const FBS_CONFERENCES = [
  { id: '8', slug: 'sec', name: 'SEC', fullName: 'Southeastern Conference', tier: 'power' },
  { id: '5', slug: 'big-ten', name: 'Big Ten', fullName: 'Big Ten Conference', tier: 'power' },
  { id: '4', slug: 'big-12', name: 'Big 12', fullName: 'Big 12 Conference', tier: 'power' },
  { id: '1', slug: 'acc', name: 'ACC', fullName: 'Atlantic Coast Conference', tier: 'power' },
  { id: '151', slug: 'american', name: 'American', fullName: 'American Conference', tier: 'group' },
  { id: '12', slug: 'cusa', name: 'Conference USA', fullName: 'Conference USA', tier: 'group' },
  { id: '15', slug: 'mac', name: 'MAC', fullName: 'Mid-American Conference', tier: 'group' },
  { id: '17', slug: 'mountain-west', name: 'Mountain West', fullName: 'Mountain West Conference', tier: 'group' },
  { id: '9', slug: 'pac-12', name: 'Pac-12', fullName: 'Pac-12 Conference', tier: 'group' },
  { id: '37', slug: 'sun-belt', name: 'Sun Belt', fullName: 'Sun Belt Conference', tier: 'group' },
  { id: '18', slug: 'independents', name: 'FBS Independents', fullName: 'FBS Independents', tier: 'independent' },
];

const FBS_BY_ID = new Map(FBS_CONFERENCES.map((c) => [c.id, c]));
const FBS_BY_SLUG = new Map(FBS_CONFERENCES.map((c) => [c.slug, c]));
const TIER_BY_SLUG = new Map(
  Object.entries(COLLEGE_TIERS)
    .filter(([tier]) => tier !== 'independent')
    .map(([tier, info]) => [info.slug, tier]),
);

export function isFbsConference(id) {
  return FBS_BY_ID.has(String(id));
}

export function fbsTier(id) {
  return FBS_BY_ID.get(String(id))?.tier ?? null;
}

export function tierFromSlug(slug) {
  return TIER_BY_SLUG.get(slug) ?? null;
}

export function fbsOrder(id) {
  const index = FBS_CONFERENCES.findIndex((c) => c.id === String(id));
  return index === -1 ? FBS_CONFERENCES.length : index;
}

/**
 * Describe a conference by ESPN id. FBS conferences come from the table above;
 * anything else (FCS) uses names discovered at runtime, when we have them.
 */
export function describeConference(id, discovered = {}) {
  if (id === null || id === undefined || id === '') return null;
  const key = String(id);
  const known = FBS_BY_ID.get(key);
  if (known) return known;
  const found = discovered[key];
  return {
    id: key,
    slug: `conf-${key}`,
    name: found?.name || null,
    fullName: found?.fullName || found?.name || null,
    tier: 'other',
  };
}

/** Map a view slug ("sec", "conf-20") back to an ESPN conference id. */
export function conferenceIdFromView(view) {
  const known = FBS_BY_SLUG.get(view);
  if (known) return known.id;
  const match = /^conf-(\d{1,6})$/.exec(view || '');
  return match ? match[1] : null;
}

export const NFL_CONFERENCES = [
  { slug: 'afc', name: 'AFC', fullName: 'American Football Conference' },
  { slug: 'nfc', name: 'NFC', fullName: 'National Football Conference' },
];

export const NFL_DIVISIONS = [
  { slug: 'afc-east', name: 'AFC East', conference: 'afc', teams: ['BUF', 'MIA', 'NE', 'NYJ'] },
  { slug: 'afc-north', name: 'AFC North', conference: 'afc', teams: ['BAL', 'CIN', 'CLE', 'PIT'] },
  { slug: 'afc-south', name: 'AFC South', conference: 'afc', teams: ['HOU', 'IND', 'JAX', 'TEN'] },
  { slug: 'afc-west', name: 'AFC West', conference: 'afc', teams: ['DEN', 'KC', 'LAC', 'LV'] },
  { slug: 'nfc-east', name: 'NFC East', conference: 'nfc', teams: ['DAL', 'NYG', 'PHI', 'WSH'] },
  { slug: 'nfc-north', name: 'NFC North', conference: 'nfc', teams: ['CHI', 'DET', 'GB', 'MIN'] },
  { slug: 'nfc-south', name: 'NFC South', conference: 'nfc', teams: ['ATL', 'CAR', 'NO', 'TB'] },
  { slug: 'nfc-west', name: 'NFC West', conference: 'nfc', teams: ['ARI', 'LAR', 'SEA', 'SF'] },
];

const DIVISION_BY_ABBR = new Map(
  NFL_DIVISIONS.flatMap((division) => division.teams.map((abbr) => [abbr, division])),
);
const DIVISION_BY_SLUG = new Map(NFL_DIVISIONS.map((d) => [d.slug, d]));

// ESPN team ids, used when an abbreviation is missing or unfamiliar.
const NFL_ABBR_BY_ID = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};
const NFL_ABBR_ALIASES = { WAS: 'WSH', OAK: 'LV', SD: 'LAC', STL: 'LAR', LA: 'LAR', JAC: 'JAX' };

export function nflDivisionOf(team = {}) {
  const abbr = String(team.abbreviation || '').toUpperCase();
  return (
    DIVISION_BY_ABBR.get(NFL_ABBR_ALIASES[abbr] || abbr) ||
    DIVISION_BY_ABBR.get(NFL_ABBR_BY_ID[team.id]) ||
    null
  );
}

export function nflDivision(slug) {
  return DIVISION_BY_SLUG.get(slug) || null;
}

export function nflConferenceOfDivision(slug) {
  return DIVISION_BY_SLUG.get(slug)?.conference ?? null;
}
