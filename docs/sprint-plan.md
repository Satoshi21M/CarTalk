# CarTalk Sprint Plan

## Goal

Ship a private Dutch MVP prototype that proves the core loop:

- user signs up
- user registers a plate
- sender speaks a plate and issue
- target user receives a short Dutch spoken alert

## Team Assumption

This plan assumes a small founding team with product, design, mobile, and backend work happening in parallel, even if some roles are combined.

## Phase 0: Foundation Decisions

Duration:

- 3 to 5 days

Deliverables:

- final MVP scope signoff
- stack decision signoff
- plate format rules for Netherlands
- moderation policy draft
- analytics event list

Exit criteria:

- no open ambiguity on the v1 core flow

## Sprint 1: Project Setup

Duration:

- 1 week

Objectives:

- create app shell
- establish environments
- set up auth foundation

Work:

- initialize React Native Expo app
- add TypeScript, routing, linting, formatting
- configure Firebase projects
- set up authentication providers
- create base screen structure
- add environment config handling

Outputs:

- app launches on iOS and Android
- login screen works
- user session persists

## Sprint 2: Onboarding and Vehicle Registration

Duration:

- 1 week

Objectives:

- onboard first users
- register vehicles safely

Work:

- welcome and language selection
- permissions flow
- safety rules acceptance
- add vehicle registration form
- implement Dutch plate normalization
- save vehicle record to backend

Outputs:

- new user can create account and register one vehicle

## Sprint 3: Voice Send Prototype

Duration:

- 1 to 2 weeks

Objectives:

- test the sender experience end to end

Work:

- push-to-talk home screen
- voice recording flow
- send request API
- Gemini extraction prototype
- sender confirmation and no-match states
- rate-limit scaffolding

Outputs:

- sender can speak a plate and issue and get a system response

## Sprint 4: Receiver Playback

Duration:

- 1 to 2 weeks

Objectives:

- make incoming alerts useful and safe

Work:

- push notification integration
- incoming alert screen
- Dutch spoken output playback
- repeat, block, and report actions
- basic message history

Outputs:

- receiving user hears a spoken alert and can take trust actions

## Sprint 5: Moderation and Abuse Controls

Duration:

- 1 week

Objectives:

- reduce misuse risk before private testing

Work:

- implement category checks
- profanity and harassment filters
- sender quotas
- report pipeline
- admin review dashboard skeleton

Outputs:

- unsafe messages are rejected
- reports can be reviewed internally

## Sprint 6: Pilot Hardening

Duration:

- 1 to 2 weeks

Objectives:

- make the prototype usable for a small Dutch pilot

Work:

- crash fixes
- analytics dashboards
- delivery reliability checks
- Bluetooth behavior tests
- UX polish for driving-safe flows

Outputs:

- private beta-ready build

## Pilot Scope

Keep the first pilot intentionally small.

Recommendation:

- 25 to 100 Dutch users
- opt-in test group
- a mix of iPhone and Android
- real driving plus parked simulation tests

## Must-Have Acceptance Criteria

Before pilot:

- sign up works reliably
- registered plate can be matched correctly
- no-match response is clear
- unsafe content is blocked
- receiver can report abuse
- alert playback works on major test devices

## Product Questions To Resolve During Build

- Should senders confirm recognized plate text before delivery
- Should low-confidence messages be retried or discarded
- How much of the original sender wording is preserved
- Whether alert playback should auto-play or require tap in some cases

## Metrics For The First 30 Days Of Pilot

- percentage of users who complete onboarding
- percentage of users who register a plate
- number of successful sends
- delivery success rate
- false match count
- abuse reports per 100 sends
- repeat weekly usage

## Founder Priorities Beyond Coding

While we build, these parallel tracks matter too:

- Dutch legal and privacy review
- brand and trust positioning
- early tester recruitment
- app store policy review
- partnerships with driving communities

## Recommended Immediate Next Step

Build Sprint 1 now:

- scaffold the Expo app
- configure Firebase
- create onboarding, auth, and vehicle registration screens

That gives us a real product skeleton fast and sets up the rest cleanly.
