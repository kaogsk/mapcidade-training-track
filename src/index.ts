import { createApp } from "./app.js";
import { createAuth } from "./auth/index.js";
import { FakeDirectory } from "./auth/fakeDirectory.js";
import { config } from "./config.js";
import { loadContent } from "./content.js";
import { openSqliteStore } from "./sqliteStore.js";

const content = loadContent(config.contentFile);
const store = openSqliteStore(config.databaseFile, { managers: config.managers });
const directory = FakeDirectory.fromFile(config.auth.directory.file);
const auth = createAuth(directory);

const server = createApp(auth, content, store).listen(config.port, config.host, () => {
  console.log(
    `[training] ${content.total} lessons, fixed managers: ${config.managers.join(", ") || "-"} — http://${config.host}:${config.port}`,
  );
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
