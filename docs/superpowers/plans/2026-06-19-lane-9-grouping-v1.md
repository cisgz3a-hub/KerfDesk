# Lane 9 Grouping V1

Date: 2026-06-19
Repo: LaserForge-2.0

## Goal

Add LightBurn-style Group/Ungroup foundations without changing emitted output.
The first version keeps scene objects flat and stores groups as metadata on the
scene. Selecting one grouped member expands to the full group, so existing
multi-selection actions can operate on the same objects the compiler already
understands.

## Decision

Use `scene.groups`:

```ts
type SceneGroup = {
  readonly id: string;
  readonly name: string;
  readonly objectIds: ReadonlyArray<string>;
};
```

Do not add a `group` `SceneObject` in V1. A group object would require new arms
in render, hit-test, output-scope, preflight, compile, frame bounds, project IO,
clipboard, and transform code. Metadata grouping keeps the G-code path
byte-stable because `compileJob(scene, device)` still walks `scene.objects`.

## Behavior

- Group requires at least two live selected objects.
- Group creation removes selected objects from older groups, prunes groups with
  fewer than two remaining members, then creates a new group in scene order.
- Selecting a grouped member selects every live member in that group.
- Shift-toggle and marquee selection expand grouped hits to full groups.
- Ungroup removes any group touched by the current selection.
- Delete/cut remove deleted members from groups and prune small groups.
- Old `.lf2` files load with `scene.groups: []`.
- Project validation accepts only groups with finite string ids, string names,
  and at least two string object ids.

## Non-Goals

- No new `SceneObject` variant.
- No nested groups.
- No arbitrary group-level transform record.
- No OS clipboard integration.
- No compiler, G-code, frame, preflight, or preview output changes.

## Tests

- `createProject()` starts with `scene.groups: []`.
- Project IO round-trips groups and backfills old files to `[]`.
- Invalid group shapes are rejected.
- `groupSelection()` is one undoable dirty edit and creates one group.
- Selecting or marquee-selecting a grouped member selects the full group.
- `ungroupSelection()` removes touched groups as one undoable dirty edit.
- Delete/cut prune group membership.
- Edit menu and shortcuts expose Group/Ungroup with selection gates.
