# Project Form Delete Button Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soften the Edit Project modal’s “Delete project” control into a muted text link so it no longer competes with Save.

**Architecture:** Keep footer layout. Remove the shared `.danger` class from the delete button and restyle `.project-form-delete` as a borderless muted link that turns danger-colored on hover/focus.

**Tech Stack:** React (`ProjectFormModal.tsx`), global `styles.css`, existing CSS variables (`--fb-text-secondary`, `--fb-danger`).

## Global Constraints

- Layout unchanged: delete left, cancel/save right.
- No i18n / copy changes.
- Keep `window.confirm` delete flow.
- Do not change source-folder UI or create-mode footer.
- Do not commit unless the user explicitly asks.

---

### Task 1: Soften delete button styles

**Files:**
- Modify: `src/components/CLI/ProjectFormModal.tsx` (delete button `className`)
- Modify: `styles.css` (`.project-form-delete` rules near existing `project-form-actions`)

**Interfaces:**
- Consumes: existing `handleDelete`, `saving`, `t("conversations.deleteProject")`
- Produces: visual-only change; no new props/APIs

- [x] **Step 1: Remove `danger` from the delete button classList**

In `src/components/CLI/ProjectFormModal.tsx`, change:

```tsx
<button
  type="button"
  className="project-form-delete"
  onClick={() => void handleDelete()}
  disabled={saving}
>
  {t("conversations.deleteProject")}
</button>
```

(Previously `className="danger project-form-delete"`.)

- [x] **Step 2: Restyle `.project-form-delete` as a muted text link**

Replace/extend the existing block in `styles.css`:

```css
.project-form-delete {
  margin-right: auto;
  padding: 8px 4px;
  border: none;
  background: transparent;
  color: var(--fb-text-secondary);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  box-shadow: none;
}

.project-form-delete:hover:not(:disabled),
.project-form-delete:focus-visible:not(:disabled) {
  color: var(--fb-danger);
  background: transparent;
}

.project-form-delete:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [x] **Step 3: Manual verify**

1. Open Edit Project on a multi-folder project.
2. Confirm delete is muted text (no red border/fill at rest).
3. Hover/focus → text turns danger red.
4. Click → confirm dialog still appears; Cancel leaves modal open.
5. Cancel/Save look unchanged; create-project modal has no delete control.

- [ ] **Step 4: Commit only if user requests**

Do not commit by default. If asked:

```bash
git add src/components/CLI/ProjectFormModal.tsx styles.css
git commit -m "$(cat <<'EOF'
style(projects): soften delete project control as text link

EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Remove danger chrome / muted default | Task 1 Steps 1–2 |
| Hover danger color | Task 1 Step 2 |
| Cancel/Save unchanged | Task 1 (no edits to those controls) |
| Layout + confirm unchanged | Task 1 (DOM/handlers untouched) |
| Dark theme readable | Uses `--fb-text-secondary` / `--fb-danger` |
