-- DATRUM CRM — initial schema
-- Ladder (Tiki Taka): 0 Queue (researched, not contacted) →
--   1 Touch → 2 Interest → 3 Read → 4 Diagnostic → 5 Proposal → 6 Close

-- A daily batch of researched leads (Gemini, Manus, scanner…). Lets analytics
-- answer "which batches / sources / industries actually convert".
CREATE TABLE IF NOT EXISTS batches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  source     TEXT,                          -- gemini, manus, scanner, referral…
  industry   TEXT,
  region     TEXT,
  imported   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS prospects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,             -- contact person, or the firm until a person is known
  company        TEXT,
  phone          TEXT,                      -- digits incl. country code, e.g. 50761234567
  email          TEXT,                      -- lowercase
  website        TEXT,                      -- bare domain, e.g. lacgrp.com
  industry       TEXT,
  focus          TEXT,                      -- specialty inside the industry
  region         TEXT,
  kind           TEXT CHECK (kind IN ('ghost','vampire')),  -- no web presence vs. invisible/broken
  rung           INTEGER NOT NULL DEFAULT 1 CHECK (rung BETWEEN 0 AND 6),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','lost')),
  rejection_type TEXT,                      -- why it was lost (fixed list in src/db.js)
  rejection_note TEXT,
  finding        TEXT,                      -- the one concrete, verifiable finding for outreach
  next_step      TEXT,
  next_step_at   TEXT,                      -- ISO date
  notes          TEXT,
  flags          TEXT,                      -- JSON array of data-quality warnings from import
  source         TEXT,
  batch_id       INTEGER REFERENCES batches(id) ON DELETE SET NULL,
  lead_ref       TEXT,                      -- the row ID in the source batch (e.g. CRM-03)
  last_touch_at  TEXT,                      -- last event of any direction
  last_message   TEXT,                      -- summary of that last event
  last_direction TEXT,                      -- out | in | none
  last_channel   TEXT,
  last_outcome   TEXT,                      -- outcome of the last call (no_answer, connected…)
  touches        INTEGER NOT NULL DEFAULT 0,  -- outbound touches across all channels
  touch_channels TEXT,                      -- JSON: {"call":4,"whatsapp":2,"email":1}
  -- conversation stage milestones (independent of the ladder rung)
  qualified_at      TEXT,                   -- budget + decision authority confirmed
  meeting_agreed_at TEXT,                   -- when they said yes to a meeting
  meeting_at        TEXT,                   -- when the meeting is / was scheduled for
  met_at            TEXT,                   -- the meeting actually happened
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_phone ON prospects(phone);
CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_prospects_website ON prospects(website);
CREATE INDEX IF NOT EXISTS idx_prospects_status_rung ON prospects(status, rung);
CREATE INDEX IF NOT EXISTS idx_prospects_batch ON prospects(batch_id);

-- Every touch on any channel is an event. Analytics read from here.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id  INTEGER REFERENCES prospects(id) ON DELETE CASCADE,  -- NULL = unmatched inbox item
  channel      TEXT NOT NULL CHECK (channel IN ('email','whatsapp','call','meeting','note')),
  direction    TEXT NOT NULL CHECK (direction IN ('out','in','none')),
  occurred_at  TEXT NOT NULL,
  summary      TEXT,
  body         TEXT,
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','email','paste','voice')),
  outcome      TEXT CHECK (outcome IN ('connected','no_answer','voicemail','gatekeeper','callback','wrong_number')),  -- calls only
  meta         TEXT,                        -- JSON: email addresses, subject, raw sender, etc.
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_prospect ON events(prospect_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_channel ON events(channel, direction);

-- Ladder movement log → conversion analytics.
CREATE TABLE IF NOT EXISTS rung_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  from_rung   INTEGER,
  to_rung     INTEGER NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rung_history_prospect ON rung_history(prospect_id);
