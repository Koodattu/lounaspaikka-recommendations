# Lunch Recommendations

This context describes how published lunch offerings become shared daily restaurant recommendations.

## Language

**Daily recommendation set**:
An ordered top three of restaurants for one service date, shared by every reader in the first version.
_Avoid_: Personalized ranking, user recommendations

**Recommendation profile**:
The fixed taste and priority assumptions used to assess lunch offerings. The first version has one shared profile; user-specific profiles may be introduced later.
_Avoid_: User preferences, personalization

**Restaurant catchment**:
Every restaurant returned by the lunch source within 50 kilometres of the fixed Seinäjoki centre point. All returned restaurants are eligible for assessment and recommendation.
_Avoid_: Nearby restaurants, practical driving radius

**Recommendation rationale**:
A brief Finnish explanation of why a restaurant belongs in a daily recommendation set. It is user-facing justification, not the model's hidden reasoning.
_Avoid_: Chain of thought, LLM reasoning
