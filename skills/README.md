# Claude skills for the artifact build

Two skills for the Claude artifact version of Rage With The Machine (the buildless `app/` folder). Both work on the
artifact's `db` capability directly (collections `gyms`, `customCatalog`, `gymExercises`, `sessions`, `sets`, `kv`;
document shapes in `app/DEVELOPING.md`).

| Skill | What it does |
| --- | --- |
| `rwtm-artifact-gym-add` | From photos of gym machines: identifies each exercise, reads its loading (stack, plates, add-ons, lb→kg, levels; asks rather than guesses), picks or creates the gym, skips or offers to update machines already there, creates custom exercises when needed, and writes `gymExercises` documents in one batch. Then reads them back and summarises. Replaces the file-based `gym-add` skill's export/import step. |
| `rwtm-artifact-training-analysis` | Read-only. Reads every collection and analyses training with the app's own formulas (Epley e1RM, volume = Σ weight × reps over kg sets, PRs per machine for machine exercises and per exercise across gyms otherwise). Answers a question, or reports frequency, per-exercise progress, plateaus, weekly sets per muscle group, body weight and 3–5 evidence-based suggestions. |

## Before uploading

Publish the artifact first, then replace `{{ARTIFACT_URL}}` in both `SKILL.md` files with its claude.ai link
(for example `https://claude.ai/artifact/...`). Without it the skills ask the user for the link each time.

```sh
sed -i 's#{{ARTIFACT_URL}}#https://claude.ai/artifact/<id>#' skills/*/SKILL.md
```

## Uploading to claude.ai

Zip each skill folder on its own, so the zip holds the folder with its `SKILL.md`:

```sh
cd skills
zip -r rwtm-artifact-gym-add.zip rwtm-artifact-gym-add
zip -r rwtm-artifact-training-analysis.zip rwtm-artifact-training-analysis
```

Upload each zip via claude.ai Settings → Skills and turn it on.
In Claude Code, the folders can instead be copied to `~/.claude/skills/`.
