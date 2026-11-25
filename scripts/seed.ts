/**
 * Fills the demo database with fictional analysts at different points of the track, so the
 * management dashboard has something to show. Re-running replaces their progress.
 *
 * Usage: npm run seed
 */
import { config } from "../src/config.js";
import { loadContent } from "../src/content.js";
import { simulate } from "../src/simulate.js";
import { openSqliteStore } from "../src/sqliteStore.js";

const content = loadContent(config.contentFile);
const store = openSqliteStore(config.databaseFile, { managers: config.managers });

const analysts = [
  { username: "ana.rivers", name: "Ana Rivers", seed: 11, skill: 0.9, lessons: 99 },
  { username: "bruno.lake", name: "Bruno Lake", seed: 23, skill: 0.6, lessons: 4 },
  { username: "carla.oak", name: "Carla Oak", seed: 37, skill: 0.75, lessons: 6, tracks: ["Viewer", "Edit"] },
  { username: "diego.marsh", name: "Diego Marsh", seed: 41, skill: 0.45, lessons: 2, tracks: ["Viewer"] },
];

store.db.exec("delete from answer; delete from lesson_completed; delete from progress;");
for (const a of analysts) {
  const sim = simulate(content, a);
  await store.touchUser(a.username, a.name);
  for (const ans of sim.answers) await store.recordAnswer(a.username, ans);
  await store.saveProgress(a.username, a.name, sim.state);
  await store.recordAccess(a.username, "login", "198.51.100.20");
  console.log(`${a.username.padEnd(12)} ${Object.keys(sim.state.done).length} lessons, ${sim.state.xp} XP, ${sim.answers.length} answers`);
}
store.close();
console.log(`seeded ${config.databaseFile}`);
