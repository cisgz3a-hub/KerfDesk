## ADR-540 Amendment 3 - Pro admission for Boolean results and isolated Weld operations (2026-10-02)

**Status:** Implemented locally; release and deployment remain separate.
**Amends:** ADR-540 Amendment 1 item 6.

The full-product audit reproduced two authoring paths that created an independent
Pro operation in desktop Free without asking for Pro. Boolean Subtract, Intersect
and Exclude cloned the first selected artwork's operation into a fresh operation.
Weld cloned an effective operation when saved object power or an operation override
needed isolation. Both paths published the operation through the ordinary setter.

1. Boolean results use the shared Pro copy admission setter. A result that creates
   an independent V-carve, relief or adaptive pocket operation asks for Pro before
   any project, selection or history change is published. Removing the source
   artwork does not exempt creation of the independent operation.
2. Weld checks only newly introduced Pro operation identities or a new Pro choice
   on an operation. Ordinary Weld preserves its existing operations and stays
   available in desktop Free, even though its combined artwork gets a new ID.
   Only isolated effective-operation clones require admission. The result's
   artwork ID alone is not evidence that an independent Pro operation was created.
3. Both paths use the existing deferred admission transaction. An unlock commits
   once, and only while the same project and document epoch remain current. A held
   edit leaves selection, dirty state and undo history unchanged. Ordinary Free
   results commit immediately.

This closes missing admission at existing authoring boundaries. It does not
change the Free/Pro tool list, the ability to edit existing desktop Pro work,
history restoration or the rule that output, Frame, Start and running jobs never
check entitlement. It makes no claim of unbreakable client-side DRM.

Focused regression scenarios cover all three Boolean tools, Weld with saved
object power or operation overrides, V-carve, both relief cut types, adaptive
pocketing, ordinary Free operations, unlocked Pro, deferred unlock, project and
document changes, ordinary existing-operation Weld and undo restoration.
