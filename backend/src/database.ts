import Database from "better-sqlite3";

const migrationOne = `
  CREATE TABLE restaurants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    latitude REAL,
    longitude REAL,
    website_url TEXT,
    phone TEXT,
    photo_url TEXT,
    description_text TEXT,
    opening_hours_json TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE source_fetches (
    id INTEGER PRIMARY KEY,
    service_date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    outcome TEXT NOT NULL,
    http_status INTEGER,
    error_message TEXT,
    request_json TEXT NOT NULL,
    response_pages_json TEXT,
    response_hash TEXT,
    item_count INTEGER
  );

  CREATE TABLE offering_revisions (
    id INTEGER PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
    service_date TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    availability TEXT NOT NULL,
    menu_title TEXT,
    menu_text TEXT,
    lunch_hours TEXT,
    source_snapshot_json TEXT NOT NULL,
    first_seen_fetch_id INTEGER NOT NULL REFERENCES source_fetches(id),
    created_at TEXT NOT NULL,
    UNIQUE (restaurant_id, service_date, content_hash)
  );

  CREATE TABLE fetch_observations (
    fetch_id INTEGER NOT NULL REFERENCES source_fetches(id),
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
    revision_id INTEGER NOT NULL REFERENCES offering_revisions(id),
    PRIMARY KEY (fetch_id, restaurant_id)
  );

  CREATE INDEX source_fetches_by_date ON source_fetches(service_date, id);
  CREATE INDEX offering_revisions_by_restaurant_date
    ON offering_revisions(restaurant_id, service_date, id);
`;

const migrationTwo = `
  CREATE TABLE assessments (
    id INTEGER PRIMARY KEY,
    revision_id INTEGER NOT NULL REFERENCES offering_revisions(id),
    profile_version TEXT NOT NULL,
    rubric_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    model TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    total_score REAL NOT NULL CHECK (total_score BETWEEN 0 AND 10),
    rationale_fi TEXT NOT NULL,
    provider_response_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    assessed_at TEXT NOT NULL,
    UNIQUE (
      revision_id, profile_version, rubric_version,
      prompt_version, schema_version, model
    )
  );

  CREATE TABLE recommendation_sets (
    id INTEGER PRIMARY KEY,
    service_date TEXT NOT NULL,
    profile_version TEXT NOT NULL,
    ranking_version TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (service_date, profile_version, ranking_version, input_hash)
  );

  CREATE TABLE recommendation_entries (
    set_id INTEGER NOT NULL REFERENCES recommendation_sets(id),
    rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
    assessment_id INTEGER NOT NULL REFERENCES assessments(id),
    PRIMARY KEY (set_id, rank),
    UNIQUE (set_id, assessment_id)
  );

  CREATE INDEX recommendation_sets_by_date
    ON recommendation_sets(service_date, id);
`;

const migrationThree = `
  CREATE TABLE custom_sources (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE custom_source_runs (
    id INTEGER PRIMARY KEY,
    custom_source_id INTEGER NOT NULL REFERENCES custom_sources(id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    outcome TEXT NOT NULL,
    http_status INTEGER,
    error_message TEXT,
    source_text TEXT,
    content_hash TEXT,
    extracted_json TEXT,
    model TEXT,
    prompt_version TEXT,
    provider_response_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER
  );

  ALTER TABLE restaurants
    ADD COLUMN custom_source_id INTEGER REFERENCES custom_sources(id);
  ALTER TABLE source_fetches
    ADD COLUMN custom_source_id INTEGER REFERENCES custom_sources(id);
  ALTER TABLE source_fetches
    ADD COLUMN custom_run_id INTEGER REFERENCES custom_source_runs(id);
  ALTER TABLE offering_revisions ADD COLUMN price_text TEXT;

  CREATE UNIQUE INDEX restaurants_by_custom_source
    ON restaurants(custom_source_id)
    WHERE custom_source_id IS NOT NULL;
  CREATE INDEX source_fetches_by_date_source
    ON source_fetches(service_date, custom_source_id, id);
  CREATE INDEX custom_source_runs_by_source
    ON custom_source_runs(custom_source_id, id);
`;

const migrationFour = `
  ALTER TABLE assessments ADD COLUMN structured_menu_json TEXT;
`;

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");

  let version = db.pragma("user_version", { simple: true }) as number;
  if (version < 1) {
    db.transaction(() => {
      db.exec(migrationOne);
      db.pragma("user_version = 1");
    })();
    version = 1;
  }
  if (version < 2) {
    db.transaction(() => {
      db.exec(migrationTwo);
      db.pragma("user_version = 2");
    })();
    version = 2;
  }
  if (version < 3) {
    db.transaction(() => {
      db.exec(migrationThree);
      db.pragma("user_version = 3");
    })();
    version = 3;
  }
  if (version < 4) {
    db.transaction(() => {
      db.exec(migrationFour);
      db.pragma("user_version = 4");
    })();
  }

  return db;
}
