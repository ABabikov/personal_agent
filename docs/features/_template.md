# Feature: [Name]

## Description Template

Скопируй эту папку для создания новой фичи:
```
docs/features/<feature-name>/
  description.md   — бизнес-описание
  plan.md           — план реализации
  status.md         — текущий статус
```

---

### description.md — шаблон

```markdown
# [Feature Name]

## Problem
Какую проблему решаем? Что болит?

## Goal
Чего хотим достичь? Какой результат считаем успехом?

## Daily Routine Automated
Какую конкретную ежедневную рутину закрываем?
- [ ] Рутина 1
- [ ] Рутина 2

## User Stories
- Как пользователь, я хочу ..., чтобы ...
- Как пользователь, я хочу ..., чтобы ...

## Data Sources
Откуда берём данные?
| Source         | Type          | Access Method |
|----------------|--------------|---------------|
| Example API    | REST API     | API Key       |

## Key Metrics
Как измеряем успех фичи?
- Metric 1: ...
- Metric 2: ...
```

---

### plan.md — шаблон

```markdown
# [Feature Name] — Implementation Plan

## Phases

### Phase 1: MVP
- [ ] Task 1
- [ ] Task 2
Estimated scope: ...

### Phase 2: Enhancement
- [ ] Task 1
- [ ] Task 2

## Technical Decisions
| Decision          | Choice     | Rationale          |
|-------------------|------------|--------------------|
| Storage           | SQLite     | Simplicity for MVP |

## Dependencies
- External: ...
- Internal: ...

## Risks
- Risk 1: ... Mitigation: ...
```

---

### status.md — шаблон

```markdown
# [Feature Name] — Status

## Current Phase: [Phase 1 / Phase 2 / ...]
## Status: [Not Started / In Progress / Done / Blocked]

## Progress
| Task                | Status      | Date       |
|---------------------|-------------|------------|
| Task 1              | Done        | 2026-04-15 |
| Task 2              | In Progress | -          |

## Blockers
- None / Description of blocker

## Notes
- ...
```
