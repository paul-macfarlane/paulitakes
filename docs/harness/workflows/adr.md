# Adr workflow

Follow `AGENTS.md`; explicit user scope overrides commit/push/PR defaults below. Paths are repository-root relative.

Create a new ADR for: **the user-supplied arguments**

1. Find the next number: the highest `NNNN-*.md` in `docs/adr/` + 1, zero-padded to 4 digits.
2. Copy `docs/adr/template.md` to `docs/adr/NNNN-<kebab-title>.md`.
3. Fill it in from the current conversation context: the real context/forces, the decision made, and its consequences. Status `Accepted` unless the user says it's still proposed. Date it today. Link related FR-x.y, technical-design.md sections, and backlog task IDs.
4. Add a row to the index table in `docs/adr/README.md`.
5. If this decision changes the baseline in `docs/technical-design.md`, update that doc too and note it in the ADR's Related line.
6. Report the path created and a one-line summary of the decision.

Keep it tight — an ADR is a few sentences per section, not an essay.
