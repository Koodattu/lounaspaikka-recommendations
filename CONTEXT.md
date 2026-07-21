# Lunch Recommendations

This context describes how published lunch offerings become shared daily restaurant recommendations.

## Language

**Daily recommendation set**:
An ordered top three of restaurants for one service date, shared by every reader in the first version.
_Avoid_: Personalized ranking, user recommendations

**Recommendation publication run**:
One bounded attempt to collect relevant source updates and publish Daily recommendation sets for a fixed group of service dates. Scheduled refresh and custom-source addition can initiate a run while retaining distinct trigger and failure reporting.
_Avoid_: Refresh, recompute

**Recommendation profile**:
The fixed taste and priority assumptions used to assess published lunch-menu facts without restaurant identity. The first version has one shared profile; user-specific profiles may be introduced later.
_Avoid_: User preferences, personalization

**Restaurant catchment**:
Every restaurant returned by Lounaspaikka within 50 kilometres of the fixed Seinäjoki centre point. All returned restaurants are eligible for assessment and recommendation. Custom menu pages are a separate source path.
_Avoid_: Nearby restaurants, practical driving radius

**Daily offering snapshot**:
The set of published lunch offerings considered current for one service date, using the latest successful observation from each enabled source. A later failed observation does not replace it.
_Avoid_: Latest menus, current rows

**Recommendation rationale**:
A brief Finnish explanation of why a restaurant belongs in a daily recommendation set. It is user-facing justification, not the model's hidden reasoning.
_Avoid_: Chain of thought, LLM reasoning
