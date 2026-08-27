# Vendored skills

Design and animation skills from [emilkowalski/skills](https://github.com/emilkowalski/skills),
copied in at commit `d23d7f8` so that anyone working on this repository — or any
Claude Code session opened against it — has them available without installing
anything.

MIT licensed; see [LICENSE](LICENSE). Nothing here has been modified.

## What's here

Most of these apply directly to `web/`, which is React + Vite + Tailwind:

| Skill | For |
| --- | --- |
| `animate` | Building an animation from scratch |
| `review-animations` | Critiquing motion in a diff |
| `improve-animations` | Auditing motion across the codebase |
| `find-animation-opportunities` | Finding places that should animate but don't |
| `animation-vocabulary` | Naming a motion effect you can only describe |
| `apple-design` | Gesture-driven UI, springs, materials, typography |
| `emil-design-eng` | UI polish and component design judgement |
| `ask-sonner` | Toast notifications (Sonner) |
| `pick-ui-library` | Choosing a component library |
| `prototype` | Throwaway prototypes |

Two are for platforms this project doesn't currently use — `animate-expo`
(React Native) and `write-swift` — and are kept only so the set stays whole and
easy to update. They will not trigger on this codebase.

## Updating

```sh
git clone --depth 1 https://github.com/emilkowalski/skills /tmp/ek-skills
cp -r /tmp/ek-skills/skills/. .claude/skills/
cp /tmp/ek-skills/LICENSE .claude/skills/LICENSE
```

Then update the commit reference at the top of this file.
