# Test fixtures

Sample responses in the shape of ESPN's public site API, used by the unit
tests. The games, scores and polls are made up (a fictional 2026 Week 4
college slate and Week 3 NFL slate), but the structure mirrors what
`site.api.espn.com` returns:

| File | Endpoint |
| --- | --- |
| `nfl-scoreboard.json` | `/apis/site/v2/sports/football/nfl/scoreboard` |
| `college-scoreboard.json` | `/apis/site/v2/sports/football/college-football/scoreboard?groups=80` |
| `fcs-scoreboard.json` | `/apis/site/v2/sports/football/college-football/scoreboard?groups=81` |
| `college-rankings.json` | `/apis/site/v2/sports/football/college-football/rankings` |
| `fcs-standings.json` | `/apis/v2/sports/football/college-football/standings?group=81` |
