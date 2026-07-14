# Seinäjoki lunch recommendations v1

## Destination

An implementation-ready specification for a small Finnish public service that ingests every restaurant returned within 50 kilometres of the fixed Seinäjoki centre, produces one shared daily top three, exposes daily and restaurant-week views, and runs unattended on one Docker Compose host.

## Notes

- Keep the product and implementation deliberately small; prefer direct, reversible choices over infrastructure or abstractions.
- The UI and all recommendation rationales are Finnish. OpenAI instructions may be English, but structured user-facing output must be Finnish.
- Recommendations are shared by every reader. Personalization is deferred.
- The source query uses latitude `62.7907`, longitude `22.8396`, and `maxdist=50000`; every returned restaurant is eligible.
- Preserve source revisions and assessment provenance so later features can be added without re-fetching unavailable history.
- Read [`CONTEXT.md`](../../CONTEXT.md) for canonical domain language.
- Sessions should use Wayfinder and domain modeling; use research, prototype, OpenAI docs, and interface-polish skills when their ticket calls for them.
- This map resolves decisions and produces a specification. Implementation starts after the map is complete.

## Decisions so far

<!-- Closed tickets are indexed here. -->

## Not yet specified

- The implementation work breakdown and exact verification boundaries, once the feed, rubric, persistence, reader journey, and stack decisions are known.
- The precise API and database contracts, once the persisted model and screen needs are fixed.
- Feed-specific parsing exceptions that only become visible while the source contract is documented.

## Out of scope

- Accounts, user-specific preferences, or personalization.
- Multiple regions, live user location, route planning, or a distance-based eligibility cutoff inside the 50-kilometre source response.
- Restaurant self-service, an admin CMS, notifications, social features, or public ratings.
- Dish-level normalization, nutrition or allergen inference, and claims beyond source-provided dietary labels.
- Additional menu sources, historical analytics, queues, Redis, multiple backend replicas, or other scale infrastructure.
- Writing or deploying the application during this planning map.
