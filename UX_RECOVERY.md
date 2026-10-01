# UX development recovery checkpoint — 2026-10-01

Status: blocked by the execution environment going offline, not a completed release.
Public main remains 211ed8876aadf8711d0e3b00fc34b398008f345f. Do not announce or deploy the UX release before browser verification.
The implementation was written in /workspace/scratch/1344f7cf2782/english-study, but its continued availability cannot be confirmed while the execution environment is disconnected.

## Authorized scope
User: 全权交给你，你持续改进，直至完成所有开发及验证。
Complete the local reading UX improvements; keep existing learning records and original material compatible. No reading scroll progress bar. Do not add an account, private cloud backend, paid API, or publish personal learning data. Device switching uses a complete backup/restore migration. Automatic cloud sync remains out of this local-only scope.

## Written locally before disconnection
- New experience-core.js: pending sentence snapshots; bounded mixed review rounds; transfer only to a different genuine context with the same recorded sense; separate self-ratings and objective question scores; review session/history validation; local vocabulary lookup; bounded dictionary payload parsing.
- New experience-ui.js and experience.css: select sentence/capture; pending drafts/reveal/analyze/undo; original-reading return points; hidden-answer review sessions with resume; quick occurrence-specific meaning correction; local/explicit remote dictionary lookup and saved lookup notes; manual content verification; reading difficulty; learning recap; actual save state and backup age.
- New import-core.js: whole-selection validation before any writes; 1–50 files, individual 10 MB, combined 50 MB; rejects duplicate IDs and rejects all files if any are invalid.
- New offline.js and service-worker.js: public shell cache; network-failure navigation/package fallback; explicit saved-before-update; no caching of private writes or external dictionary responses.
- Reader integration: paragraph practice buttons; preserve tab/article/scroll return context; complete-and-continue action; date/topic/read-state filters; cross-module learning refresh.
- Workspace integration: quick correction, search condition restoration, quiz completion/next task, real committed draft feedback, backup generation timestamp.
- Optional package topics and paragraph analysis [{quote,core,logic,note}], exact quote validation; compiled sentence analysis preserved in snapshots/full editor; prompt .md and .txt extended.
- Workspace store: committed status, retry, no legacy mirror before commit, serialized writes, envelope head token, BroadcastChannel conflicts, guarded atomic restore/rollback and batch package writes.
- Backup merge: new state preserved/deduplicated; original conflict-copy word references in review rounds remapped.
- Two optional manual starter analyses in practice-content.js.
- Temporary qa-phone.html with an actual same-origin reader iframe at 390 / 360 CSS pixels. Remove this temporary harness before the final release.

## Recorded checks
Last complete local run: node --test tests/*.test.cjs — 70 tests, 70 passed, 0 failed.
49 prior tests passed; 13 experience tests, 3 added storage tests, 5 offline tests passed.
The offline tests detected a missing reader.js cache entry; that was fixed, then all 70 passed.
node --check passed on reader.js, experience-ui.js, workspace-ui.js, learning.js, package-core.js, workspace-core.js, workspace-store.js, imports.js, service-worker.js.
These outcomes apply to the local files at that point, not to this checkpoint branch (which preserves recovery notes only).

## Resume
1. Recover the original workspace and inspect git status. If missing, use the exact code/patch calls from this conversation to reconstruct; do not claim the local code was persisted remotely.
2. Read frontend-testing-debugging guidance. Use CUA for browser interactions. Browser plugin is absent and the local Chromium executable is missing.
3. CUA Chrome cdp browser ID 1, prior tab 2 at https://lin14159265.github.io/english-study/?v=20261001-tools-4#article-01. On recovery reread CUA documentation.
4. Before altering the browser profile, export current records through the backup UI and retain the complete JSON. All QA records must be explicitly named fixtures; restore the prior profile at the end.
5. Stage actual changed file bytes via GitHub create_blob/create_tree/create_commit and update_ref without force. Never git push. Check the newest remote main before committing; avoid losing other changes.
6. Desktop QA: capture → own draft → reveal → save wrong sentence; review resume/reveal/rate; objective wrong-question round; transfer to another genuine context; refresh recovery; quick correction of a repeated occurrence; structure vs manual verification invalidation; search → original → restored search conditions; complete reading/queue/quiz and continue; arbitrary lookup saves/failure state; full and split backup/restore/rollback; batch import one-invalid-file and duplicates; source updates retain historical snapshots.
7. Check secondary issues found during code review: original revised compilation can drop unaudited legacy word annotations (One/except/Clever); preserve only genuine original positions, without borrowing another occurrence's sense. Ensure answers remain hidden before reveal and any asynchronous status cannot claim a failure as saved.
8. Mobile QA through the authored 390/360 iframe, keyboard focus and no horizontal overflow. This is browser layout validation, not a real touch-device test.
9. Verify actual service-worker cache readiness in the live browser. Only mocked network-failure tests are done; no live disconnection test yet. Do not describe mocked tests as a physically disconnected device test.
10. Re-run appropriate tests after fixes, publish final assets with a new consistent cache version, wait for Pages deployment success, then verify live DOM and console errors. Update UX_DEVELOPMENT.md with actual outcomes and remove temporary QA harness.
11. Save a verified screenshot, use Library persistence for that user-facing image (the git-backed project itself must not be duplicated in Library).
12. Final response in Chinese: live verified link, concise implemented changes, testing outcome, and explicit limits: manual device migration rather than automatic cloud sync; real mobile device not tested if unavailable.

## Interruption evidence
CUA failed: environment registry request failed (409 Conflict, environment_offline): Environment is not connected.
Terminal failed: exec-server transport disconnected; failed to resume exec-server session: recovery timed out after 25s.
Initial upload preparation failed before files/blobs were staged; no UX code has been committed to main.
No permission or automatic approval rejection caused the interruption.
